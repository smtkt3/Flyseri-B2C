import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { RedisStore } from '@flyseri/redis';
import type { CustomerProfile, SeriConversationSummary, SeriMessage, SeriTurnResponse } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, AI_PROVIDER, AI_STORE, REDIS_STORE } from '../tokens.js';
import type { AuthenticatedUserContext } from '../request-context.js';
import { CustomerService } from '../customer/customer.service.js';
import { TripService } from '../trip/trip.service.js';
import { VisaService } from '../visa/visa.service.js';
import { DocumentService } from '../document/document.service.js';
import { FlightService } from '../flight/flight.service.js';
import { BookingIntentService } from '../flight/booking-intent.service.js';
import { FlightBookingsService } from '../flight/flight-bookings.service.js';
import { CommerceService } from '../commerce/commerce.service.js';
import type { AiFunctionDeclaration, AiProvider } from './ai-provider.js';
import { GeminiProvider } from './ai-provider.js';
import { SeriRepository } from './seri.repository.js';
import { SeriToolRegistry, type ToolContext, type ToolResult } from './seri.tools.js';
import { SERI_PROMPT_VERSION, SERI_SYSTEM_PROMPT } from './seri.prompt.js';

const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Seri is temporarily unavailable. Your trips and bookings are still safe.', 503);
const messageError = () => new ApiException('VALIDATION_ERROR', 'Send a message of up to 4,000 characters.', 400);
const isFlightSearch = (text: string) => /\b(find|search|look for|show|book|compare)\b.*\b(flight|flights|airfare|airfares)\b|\b(flight|flights|airfare|airfares)\b.*\b(find|search|to|from)\b/i.test(text);
const isExplicitSupportRequest = (text: string) => /\b(speak|talk|connect|contact|reach)\b.{0,35}\b(human|person|agent|someone|support|team|representative)\b|\b(human support|customer support)\b/i.test(text);
const redactSensitive = (text: string) => text
  .replace(/[^\n.!?]*(?:passport image|passport photo|bank statement|bank details|bank account|account number|payment card|card number|full identity document|document contents)[^\n.!?]*[.!?]?/gi, '[redacted sensitive request]')
  .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted payment number]')
  .replace(/\b(?:passport|account|bank account|routing|sort code)\s*(?:number|no\.?|#)?\s*[:#-]?\s*[A-Z0-9 -]{5,24}/gi, '[redacted sensitive detail]')
  .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, '[redacted token]')
  .slice(0, 4000);
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function operationFailureMessage(name: string) { return name === 'searchFlights' ? 'I couldn’t complete that flight search just now. Please try again from Find Flights.' : 'I couldn’t retrieve that information right now. Please try again.'; }

@Injectable()
export class SeriOrchestratorService {
  private readonly tools: SeriToolRegistry;
  private readonly logger = new Logger(SeriOrchestratorService.name);
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(AI_PROVIDER) private readonly provider: AiProvider | undefined,
    @Inject(AI_STORE) private readonly store: SeriRepository, @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined,
    @Inject(CustomerService) customer: CustomerService, @Inject(TripService) private readonly trips: TripService,
    @Inject(VisaService) visa: VisaService, @Inject(DocumentService) documents: DocumentService,
    @Inject(FlightService) flights: FlightService, @Inject(BookingIntentService) intents: BookingIntentService,
    @Inject(CommerceService) commerce: CommerceService, @Inject(FlightBookingsService) private readonly bookings?: FlightBookingsService) {
    this.tools = new SeriToolRegistry(customer, trips, visa, documents, flights, intents, commerce);
  }

  async createConversation(user: AuthenticatedUserContext, tripId?: string): Promise<SeriConversationSummary> {
    if (tripId) await this.trips.detail(user.customerId, tripId);
    return this.store.createConversation(user.customerId, tripId ?? null);
  }
  listConversations(customerId: string) { return this.store.listConversations(customerId); }
  async prepareSupport(user: AuthenticatedUserContext, input: { reason: string; bookingId?: string }) {
    const reason = redactSensitive(input.reason.trim());
    if (!reason) throw messageError();
    if (input.bookingId && !this.bookings) throw unavailable();
    const booking = input.bookingId ? await this.bookings!.detail(user.customerId, input.bookingId) : null;
    const conversation = await this.store.createConversation(user.customerId, null);
    const summary = `${booking ? `Booking ${booking.id}; PNR ${booking.pnr ?? 'unconfirmed'}. ` : ''}${reason}`;
    await this.store.addMessage(conversation.id, { role: 'USER', content: summary });
    const action = await this.store.createPendingAction({ customerId: user.customerId, conversationId: conversation.id,
      tripId: booking?.tripId ?? null, toolName: 'requestHumanSupport', args: { reason, ...(booking ? { bookingId: booking.id } : {}) },
      riskLevel: 'CONFIRMATION_REQUIRED', expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { conversationId: conversation.id, actionId: action.id, summary, expiresAt: action.expiresAt.toISOString() };
  }
  getMessages(customerId: string, conversationId: string) { return this.store.messages(customerId, conversationId, 100); }
  async confirmAction(customerId: string, conversationId: string, actionId: string) {
    if (!await this.store.getConversation(customerId, conversationId)) throw new ApiException('NOT_FOUND', 'This Seri conversation could not be found.', 404);
    const action = await this.store.confirmPendingAction(customerId, conversationId, actionId);
    if (!action) throw new ApiException('CONFLICT', 'This confirmation has expired or was already handled.', 409);
    const message = await this.store.addMessage(conversationId, { role: 'ASSISTANT', content: 'Your request has been saved and queued for the Seri Mechan support team. They can follow up through your account contact details.', messageType: 'SUPPORT_HANDOFF', payload: { status: 'QUEUED' } });
    await this.store.recordToolCall(conversationId, 'requestHumanSupport', 'SUCCEEDED', 0, requestId());
    return message;
  }
  async cancelAction(customerId: string, conversationId: string, actionId: string) {
    if (!await this.store.getConversation(customerId, conversationId)) throw new ApiException('NOT_FOUND', 'This Seri conversation could not be found.', 404);
    const action = await this.store.cancelPendingAction(customerId, conversationId, actionId);
    if (!action) throw new ApiException('CONFLICT', 'This confirmation can no longer be cancelled.', 409);
    return this.store.addMessage(conversationId, { role: 'ASSISTANT', content: 'No support request was sent.' });
  }

  async send(user: AuthenticatedUserContext, conversationId: string, text: string, requestId: string): Promise<SeriTurnResponse> {
    const normalized = text.trim();
    if (!normalized || normalized.length > 4000) throw messageError();
    await this.limit(user.customerId);
    const conversation = await this.store.getConversation(user.customerId, conversationId);
    if (!conversation) throw new ApiException('NOT_FOUND', 'This Seri conversation could not be found.', 404);
    const trip = conversation.tripId ? await this.trips.detail(user.customerId, conversation.tripId) : null;

    const safePrompt = redactSensitive(normalized);
    await this.store.addMessage(conversation.id, { role: 'USER', content: safePrompt });
    const context: ToolContext = { customerId: user.customerId, conversationTripId: conversation.tripId,
      requestId, profile: user.profile, tripContext: trip ? { title: trip.title, status: trip.status, startDate: trip.startDate,
        endDate: trip.endDate, destinations: trip.destinations.map(({ countryCode, cityName }) => ({ countryCode, cityName })) } : null };
    const deterministic = this.routeDeterministic(normalized);
    if (deterministic) {
      const started = performance.now();
      try {
        const result = await this.runTool(deterministic.name, deterministic.args, context, conversation.id, requestId);
        const answer = await this.store.addMessage(conversation.id, { role: 'ASSISTANT', content: deterministicText(deterministic.name, result), messageType: result.messageType, payload: result.payload ?? null });
        await this.store.recordUsage({ customerId: user.customerId, conversationId, requestId, provider: null, model: null,
          kind: 'DETERMINISTIC', latencyMs: Math.round(performance.now() - started), success: true, promptVersion: SERI_PROMPT_VERSION });
        return { conversation, message: answer, deterministic: true, provider: null, promptVersion: SERI_PROMPT_VERSION };
      } catch (error) {
        if (error instanceof ApiException && error.code === 'RATE_LIMITED') throw error;
        const answer = await this.store.addMessage(conversation.id, { role: 'ASSISTANT', content: operationFailureMessage(deterministic.name) });
        await this.store.recordUsage({ customerId: user.customerId, conversationId, requestId, provider: null, model: null,
          kind: 'DETERMINISTIC', latencyMs: Math.round(performance.now() - started), success: false, promptVersion: SERI_PROMPT_VERSION });
        return { conversation, message: answer, deterministic: true, provider: null, promptVersion: SERI_PROMPT_VERSION };
      }
    }

    if (!this.config.SERI_AI_ENABLED || !this.provider) {
      const response = 'I can help plan your journey. Live Seri AI is not configured yet; you can still manage trips, search flights, and check your visa, documents, orders, and payments from Flyseri.';
      const answer = await this.store.addMessage(conversation.id, { role: 'ASSISTANT', content: response });
      await this.store.recordUsage({ customerId: user.customerId, conversationId, requestId, provider: null, model: null, kind: 'DETERMINISTIC', latencyMs: 0, success: true, promptVersion: SERI_PROMPT_VERSION });
      return { conversation, message: answer, deterministic: true, provider: null, promptVersion: SERI_PROMPT_VERSION };
    }

    const started = performance.now();
    let provider = this.provider;
    let result: { text: string; type: ToolResult['messageType']; payload?: Record<string, unknown>; inputTokens: number | null; outputTokens: number | null };
    try {
      result = await this.generateWithTools(provider, user.customerId, conversationId, context, isFlightSearch(normalized), isExplicitSupportRequest(normalized), requestId);
    } catch (error) {
      if (error instanceof ApiException && error.code === 'RATE_LIMITED') throw error;
      const fallback = this.fallbackProvider();
      if (!(error instanceof AiProviderCallFailure && error.safeForFallback) || !fallback) {
        const safeText = 'Seri is temporarily unavailable. Your trips and bookings are still safe.';
        const answer = await this.store.addMessage(conversation.id, { role: 'ASSISTANT', content: safeText });
        await this.store.recordUsage({ customerId: user.customerId, conversationId, requestId, provider: provider.name, providerTier: 'PRIMARY', model: this.config.AI_PRIMARY_MODEL, kind: 'LLM', latencyMs: Math.round(performance.now() - started), success: false, promptVersion: SERI_PROMPT_VERSION });
        return { conversation, message: answer, deterministic: false, provider: provider.name, promptVersion: SERI_PROMPT_VERSION };
      }
      provider = fallback;
      try { result = await this.generateWithTools(provider, user.customerId, conversationId, context, isFlightSearch(normalized), isExplicitSupportRequest(normalized), requestId); }
      catch {
        const answer = await this.store.addMessage(conversation.id, { role: 'ASSISTANT', content: 'Seri is temporarily unavailable. Your trips and bookings are still safe.' });
        await this.store.recordUsage({ customerId: user.customerId, conversationId, requestId, provider: provider.name, providerTier: 'FALLBACK', model: this.config.AI_FALLBACK_MODEL ?? null, kind: 'LLM', latencyMs: Math.round(performance.now() - started), success: false, promptVersion: SERI_PROMPT_VERSION });
        return { conversation, message: answer, deterministic: false, provider: provider.name, promptVersion: SERI_PROMPT_VERSION };
      }
    }
    const safeAnswer = result.type === 'CONFIRMATION' ? 'I can send a support request to the Seri Mechan team. Please confirm below to share it.' : result.text || (result.payload ? 'I found the latest information for you.' : 'Could you tell me a little more about your travel plans?');
    const answer = await this.store.addMessage(conversation.id, { role: 'ASSISTANT', content: safeAnswer, messageType: result.type, payload: result.payload ?? null });
    await this.store.recordUsage({ customerId: user.customerId, conversationId, requestId, provider: provider.name, providerTier: provider === this.provider ? 'PRIMARY' : 'FALLBACK',
      model: provider === this.provider ? this.config.AI_PRIMARY_MODEL : this.config.AI_FALLBACK_MODEL ?? null,
      kind: 'LLM', inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: Math.round(performance.now() - started), success: true, promptVersion: SERI_PROMPT_VERSION });
    return { conversation, message: answer, deterministic: false, provider: provider.name, promptVersion: SERI_PROMPT_VERSION };
  }

  private routeDeterministic(text: string): { name: string; args: Record<string, unknown> } | null {
    const s = text.toLowerCase();
    if (/\b(payment|paid|payment status|has .* gone through)\b/.test(s)) return { name: 'getPaymentStatus', args: {} };
    if (/\b(order|booking status|has .* been booked)\b/.test(s)) return { name: 'getOrders', args: {} };
    if (/\b(missing documents?|documents? am i missing|visa status|visa application)\b/.test(s)) return { name: /missing documents?|documents? am i missing/.test(s) ? 'getMissingDocuments' : 'getVisaStatus', args: {} };
    if (/\b(upcoming trip|next trip|show .* trips?|my trips)\b/.test(s)) return { name: 'getTrips', args: { upcomingOnly: /upcoming|next/.test(s) } };
    if (/\b(my travellers|my travelers|who is travelling|saved travellers)\b/.test(s)) return { name: 'getTravellers', args: {} };
    if (/\b(my documents|document summary|document expiry)\b/.test(s)) return { name: 'getDocumentsSummary', args: {} };
    if (/\b(my profile|my preferences)\b/.test(s)) return { name: 'getMyProfile', args: {} };
    return null;
  }

  private async generateWithTools(provider: AiProvider, customerId: string, conversationId: string, context: ToolContext,
    allowFlightSearch: boolean, allowSupportRequest: boolean, requestId: string) {
    const history = await this.store.messages(customerId, conversationId, this.config.AI_MAX_CONTEXT_MESSAGES);
    if (!history) throw new Error('Conversation unavailable');
    const latestFlightResultId = [...history].reverse().find((item) => item.role === 'ASSISTANT' && item.messageType === 'FLIGHT_RESULTS')?.id;
    const contents: Array<Record<string, unknown>> = history.map((item) => {
      let text = redactSensitive(item.content);
      // Carry only the latest bounded live offer set into follow-up turns. Sorting/filtering stays local
      // to Seri and never repeats a supplier search unless the customer requests a new one.
      if (item.id === latestFlightResultId && isRecord(item.payload) && Array.isArray(item.payload.offers)) {
        const offers = item.payload.offers.slice(0, 20).map((offer) => {
          if (!isRecord(offer)) return null;
          const leg = (value: unknown) => isRecord(value) ? { stops: value.stops, segments: Array.isArray(value.segments)
            ? value.segments.slice(0, 6).map((segment) => isRecord(segment) ? { origin: segment.origin, destination: segment.destination,
              departureAt: segment.departureAt, arrivalAt: segment.arrivalAt, marketingCarrier: segment.marketingCarrier,
              flightNumber: segment.flightNumber, operatingCarrier: segment.operatingCarrier } : null) : [] } : null;
          return { offerId: offer.offerId, totalAmount: offer.totalAmount, currency: offer.currency, airlineCodes: offer.airlineCodes,
            outbound: leg(offer.outbound), inbound: leg(offer.inbound), baggageSummary: offer.baggageSummary, amenities: offer.amenities };
        }).filter(Boolean);
        text += `\nPreviously retrieved flight offers (do not search again for sort/filter follow-ups): ${JSON.stringify(offers)}`;
      }
      return { role: item.role === 'ASSISTANT' ? 'model' : 'user', parts: [{ text }] };
    });
    // The current user message has already been committed to the conversation and appears in history.
    const declarations: AiFunctionDeclaration[] = this.tools.forRequest(allowFlightSearch, this.config.SERI_AI_WRITE_TOOLS_ENABLED && allowSupportRequest);
    let aggregateType: ToolResult['messageType'] = 'TEXT';
    let aggregatePayload: Record<string, unknown> | undefined;
    let aggregateToolName: string | null = null;
    let toolFailure = false;
    let inputTokens: number | null = null, outputTokens: number | null = null;
    let toolCallCount = 0;
    for (let iteration = 0; iteration <= this.config.AI_MAX_TOOL_CALLS_PER_TURN; iteration++) {
      let turn;
      try {
        const tripContext = context.tripContext ? `\nCurrent trip context (customer-owned structured data): ${JSON.stringify(context.tripContext)}` : '';
        turn = await provider.generate({ model: provider === this.provider ? this.config.AI_PRIMARY_MODEL : this.config.AI_FALLBACK_MODEL ?? this.config.AI_PRIMARY_MODEL,
          system: SERI_SYSTEM_PROMPT + tripContext, contents, tools: declarations, maxOutputTokens: this.config.AI_MAX_OUTPUT_TOKENS });
      } catch (error) { throw new AiProviderCallFailure(iteration === 0, error); }
      inputTokens = addMaybe(inputTokens, turn.inputTokens); outputTokens = addMaybe(outputTokens, turn.outputTokens);
      if (!turn.calls.length) return { text: toolFailure ? 'I couldn’t retrieve the latest information right now. Please try again.' : aggregateToolName ? deterministicText(aggregateToolName, { text: turn.text, messageType: aggregateType, payload: aggregatePayload }) : turn.text,
        type: aggregateType, payload: aggregatePayload, inputTokens, outputTokens };
      toolCallCount += turn.calls.length;
      if (iteration === this.config.AI_MAX_TOOL_CALLS_PER_TURN || toolCallCount > this.config.AI_MAX_TOOL_CALLS_PER_TURN) throw new Error('Tool limit exceeded');
      if (!turn.modelContent) throw new Error('Provider tool continuation missing');
      contents.push({ role: 'model', parts: (turn.modelContent.parts as unknown[]) ?? [] });
      const outputs: Array<Record<string, unknown>> = [];
      for (const call of turn.calls) {
        try {
          if (call.name === 'searchFlights' && !allowFlightSearch) throw new Error('Not allowed for this message');
          if (call.name === 'requestHumanSupport') {
            await this.limitToolCall(customerId);
            if (!allowSupportRequest || !this.config.SERI_AI_WRITE_TOOLS_ENABLED || Object.keys(call.args).some((key) => key !== 'reason') || (call.args.reason !== undefined && (typeof call.args.reason !== 'string' || call.args.reason.length > 200))) throw new Error('Invalid support request');
            const action = await this.store.createPendingAction({ customerId, conversationId, tripId: context.conversationTripId,
              toolName: call.name, args: { reason: typeof call.args.reason === 'string' ? call.args.reason.trim() : 'Customer requested human support' },
              riskLevel: 'CONFIRMATION_REQUIRED', expiresAt: new Date(Date.now() + 10 * 60_000) });
            aggregateType = 'CONFIRMATION';
            aggregateToolName = call.name;
            aggregatePayload = { actionId: action.id, summary: 'Send a support request to the Seri Mechan team', expiresAt: action.expiresAt.toISOString(), status: 'PENDING' };
            outputs.push({ functionResponse: { name: call.name, response: { result: 'A confirmation card has been prepared. Wait for the customer to confirm before sending the support request.' } } });
            continue;
          }
          const output = await this.runTool(call.name, call.args, context, conversationId, requestId);
          aggregateType = output.messageType;
          aggregatePayload = output.payload;
          aggregateToolName = call.name;
          outputs.push({ functionResponse: { name: call.name, response: { result: JSON.parse(output.text) } } });
        } catch (error) {
          if (error instanceof ApiException && error.code === 'RATE_LIMITED') throw error;
          toolFailure = true;
          outputs.push({ functionResponse: { name: call.name, response: { error: 'The requested information is unavailable.' } } });
        }
      }
      if (aggregateType === 'CONFIRMATION') return { text: '', type: aggregateType, payload: aggregatePayload, inputTokens, outputTokens };
      contents.push({ role: 'user', parts: outputs });
    }
    throw new Error('Tool depth exceeded');
  }

  private async runTool(name: string, args: unknown, context: ToolContext, conversationId: string, requestId: string) {
    const start = performance.now();
    try {
      await this.limitToolCall(context.customerId);
      const result = await this.tools.execute(name, context, args);
      await this.store.recordToolCall(conversationId, name, 'SUCCEEDED', Math.round(performance.now() - start), requestId);
      return result;
    } catch (error) {
      await this.store.recordToolCall(conversationId, name, 'FAILED', Math.round(performance.now() - start), requestId);
      throw error;
    }
  }

  private fallbackProvider(): AiProvider | undefined {
    if (!this.config.SERI_AI_FALLBACK_ENABLED || this.config.AI_FALLBACK_PROVIDER !== 'GEMINI' || !this.config.GEMINI_API_KEY || !this.config.AI_FALLBACK_MODEL) return undefined;
    return new GeminiProvider(this.config.GEMINI_API_KEY, this.config.AI_PROVIDER_TIMEOUT_MS);
  }

  private async limit(customerId: string) {
    if (!this.redis) { this.logger.warn('Seri request rejected because Redis rate limiting is not configured'); throw unavailable(); }
    const status = await this.redis.consumeRateLimit(`seri:message:customer:${customerId}`, this.config.AI_RATE_LIMIT_MESSAGES_PER_MINUTE, 60);
    if (status === 'limited') {
      await this.recordRateLimited();
      throw new ApiException('RATE_LIMITED', 'Please wait a moment before sending another message.', 429);
    }
    if (status === 'unavailable') { this.logger.warn('Seri request rejected because Redis rate limiting is unavailable'); throw unavailable(); }
  }

  private async limitToolCall(customerId: string) {
    if (!this.redis) { this.logger.warn('Seri tool rejected because Redis rate limiting is not configured'); throw unavailable(); }
    const status = await this.redis.consumeRateLimit(`seri:tool:customer:${customerId}`, this.config.AI_RATE_LIMIT_TOOL_CALLS_PER_MINUTE, 60);
    if (status === 'limited') {
      await this.recordRateLimited();
      throw new ApiException('RATE_LIMITED', 'Seri has reached its current activity limit. Please try again shortly.', 429);
    }
    if (status === 'unavailable') { this.logger.warn('Seri tool rejected because Redis rate limiting is unavailable'); throw unavailable(); }
  }

  private async recordRateLimited() {
    if (!this.redis || await this.redis.incrementCounter('metrics:ai_rate_limited_total') === null) {
      this.logger.warn('Seri rate-limit telemetry counter could not be updated');
    }
  }
}

function addMaybe(left: number | null, right: number | null): number | null { return left === null ? right : right === null ? left : left + right; }
function requestId() { return randomUUID(); }
class AiProviderCallFailure extends Error { constructor(readonly safeForFallback: boolean, cause: unknown) { super(cause instanceof Error ? cause.message : 'AI provider request failed'); } }
function deterministicText(name: string, result: ToolResult): string {
  const payload = result.payload ?? {};
  if (name === 'getPaymentStatus') {
    const payments = Array.isArray(payload.payments) ? payload.payments as Array<Record<string, unknown>> : [];
    if (!payments.length) return 'I couldn’t find a payment record for your account yet.';
    const payment = payments[0]!;
    return `Your latest payment status is ${String(payment.status)}${payment.amount ? ` for ${String(payment.currency)} ${String(payment.amount)}` : ''}.`;
  }
  if (name === 'getOrders') {
    const orders = Array.isArray(payload.orders) ? payload.orders as Array<Record<string, unknown>> : [];
    if (!orders.length) return 'You don’t have any orders yet.';
    const item = orders[0]!;
    return `Your latest order ${String(item.orderNumber)} is ${String(item.status)} for ${String(item.currency)} ${String(item.totalAmount)}.`;
  }
  if (name === 'getVisaStatus' || name === 'getMissingDocuments') {
    const applications = Array.isArray(payload.applications) ? payload.applications as Array<Record<string, unknown>> : [];
    if (!applications.length) return 'I couldn’t find a visa application yet. You can start visa planning from one of your trips.';
    const item = applications[0]!;
    if (Array.isArray(item.missing) && item.missing.length) return `${String(item.visaTypeName)} checklist: ${String(item.requiredCompleted)}/${String(item.requiredTotal)} required items are complete. Still needed: ${(item.missing as string[]).join(', ')}.`;
    return `Your ${String(item.visaTypeName)} application is ${String(item.status)}${typeof item.requiredCompleted === 'number' ? `, with ${item.requiredCompleted} of ${String(item.requiredTotal)} required checklist items complete` : ''}.`;
  }
  if (name === 'getTrips') {
    const trips = Array.isArray(payload.trips) ? payload.trips : [];
    return trips.length ? `I found ${trips.length} trip${trips.length === 1 ? '' : 's'} in your Flyseri account.` : 'You don’t have any trips yet. You can create one from My Trips.';
  }
  if (name === 'getTravellers') {
    const travellers = Array.isArray(payload.travellers) ? payload.travellers : [];
    return travellers.length ? `You have ${travellers.length} saved traveller${travellers.length === 1 ? '' : 's'}.` : 'You haven’t added any travellers yet.';
  }
  if (name === 'getDocumentsSummary') {
    const documents = Array.isArray(payload.documents) ? payload.documents : [];
    return documents.length ? `I found ${documents.length} saved document${documents.length === 1 ? '' : 's'}. I can show their types and statuses, but I don’t read the files themselves.` : 'You haven’t added any documents yet.';
  }
  if (name === 'getMyProfile') return 'Here are your saved Flyseri preferences.';
  if (name === 'getTrip') {
    const trip = isRecord(payload.trip) ? payload.trip : {};
    const destinations = Array.isArray(trip.destinations) ? trip.destinations as Array<Record<string, unknown>> : [];
    const destination = destinations.map((item) => item.cityName || item.countryCode).filter(Boolean).join(', ');
    return `${String(trip.title || destination || 'Your trip')} is ${String(trip.status || 'available')}${trip.startDate ? ` and starts ${String(trip.startDate)}` : ''}.`;
  }
  if (name === 'getBookingIntent') {
    const status = payload.status ? String(payload.status) : 'unavailable';
    const amount = payload.totalAmount ? ` at ${String(payload.currency)} ${String(payload.totalAmount)}` : '';
    return `Your flight selection is ${status}${amount}. It is not a ticketed booking.`;
  }
  if (name === 'getOrder') return `Order ${String(payload.orderNumber)} is ${String(payload.status)} for ${String(payload.currency)} ${String(payload.totalAmount)}.`;
  if (name === 'searchFlights') {
    const offers = Array.isArray(payload.offers) ? payload.offers : [];
    return offers.length ? `I found ${offers.length} live flight option${offers.length === 1 ? '' : 's'}. Fares and availability can change until checked again.` : 'I couldn’t find live flight options for those details. Try changing the dates or airports.';
  }
  if (name === 'requestHumanSupport') return 'I can send a support request to the Seri Mechan team. Please confirm below to share it.';
  return result.text;
}
