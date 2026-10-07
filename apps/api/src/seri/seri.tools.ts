import { plainToInstance } from 'class-transformer';
import { ApiException } from '../api-exception.js';
import { validate } from 'class-validator';
import type { CustomerProfile, FlightSearchRequest, SeriMessageType } from '@flyseri/types';
import { CustomerService } from '../customer/customer.service.js';
import { TripService } from '../trip/trip.service.js';
import { VisaService } from '../visa/visa.service.js';
import { DocumentService } from '../document/document.service.js';
import { FlightSearchDto } from '../flight/flight-search.js';
import { FlightService } from '../flight/flight.service.js';
import { BookingIntentService } from '../flight/booking-intent.service.js';
import { CommerceService } from '../commerce/commerce.service.js';
import { conditionMatches } from '../visa/visa-form.js';
import type { AiFunctionDeclaration } from './ai-provider.js';
import type { SabreMcpService } from './sabre-mcp.service.js';

export type ToolContext = { customerId: string; conversationTripId: string | null; requestId: string; profile: CustomerProfile;
  tripContext: { title: string | null; status: string; startDate: string | null; endDate: string | null; destinations: { countryCode: string; cityName: string | null }[] } | null };
export type ToolResult = { text: string; messageType: SeriMessageType; payload?: Record<string, unknown> };
type Args = Record<string, unknown>;
type Handler = (context: ToolContext, args: Args) => Promise<ToolResult>;
export interface SeriTool { declaration: AiFunctionDeclaration; risk: 'READ_ONLY' | 'LOW_RISK_WRITE' | 'CONFIRMATION_REQUIRED' | 'HIGH_RISK_NOT_ALLOWED'; requiresAuth: true; requiresConfirmation: boolean; handler: Handler }
const objectSchema = (properties: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> => ({ type: 'OBJECT', properties, ...(required.length ? { required } : {}) });
const uuidSchema = { type: 'STRING', description: 'An identifier of a resource that already belongs to the signed-in customer.' };
const empty = objectSchema();
function asUuid(value: unknown): string { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid tool arguments'); return value; }
function strictEmpty(args: Args) { if (Object.keys(args).length) throw new Error('Invalid tool arguments'); }

export class SeriToolRegistry {
  readonly tools: Map<string, SeriTool>;
  constructor(private readonly customer: CustomerService, private readonly trips: TripService, private readonly visa: VisaService,
    private readonly documents: DocumentService, private readonly flights: FlightService, private readonly intents: BookingIntentService,
    private readonly commerce: CommerceService, private readonly mcp?: SabreMcpService) {
    const def = (name: string, description: string, parameters: Record<string, unknown>, handler: Handler): SeriTool => ({
      declaration: { name, description, parameters }, risk: 'READ_ONLY', requiresAuth: true, requiresConfirmation: false, handler,
    });
    const registry: SeriTool[] = [
      def('getMyProfile', 'Get the signed-in customer profile. Returns only display name and language/currency preferences.', empty, async (c, a) => {
        strictEmpty(a); const data = { displayName: c.profile.displayName, preferredLanguage: c.profile.preferredLanguage, preferredCurrency: c.profile.preferredCurrency };
        return { text: JSON.stringify(data), messageType: 'TEXT', payload: data };
      }),
      def('getTravellers', 'List saved traveller names and relationships for the signed-in customer.', empty, async (c, a) => {
        strictEmpty(a); const data = (await this.customer.listTravellers(c.customerId)).map(({ id: _id, legalFirstName, legalLastName, relationshipType }) => ({ name: `${legalFirstName} ${legalLastName}`, relationshipType }));
        return { text: JSON.stringify(data), messageType: 'TEXT', payload: { travellers: data } };
      }),
      def('getTrips', 'List the signed-in customer trips. Use this for trip history and upcoming trip questions.', objectSchema({ upcomingOnly: { type: 'BOOLEAN' } }), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'upcomingOnly') || (a.upcomingOnly !== undefined && typeof a.upcomingOnly !== 'boolean')) throw new Error('Invalid tool arguments');
        const data = await this.trips.list(c.customerId, a.upcomingOnly ? { period: 'upcoming' } : {});
        return { text: JSON.stringify(data), messageType: 'TRIP_CARD', payload: { trips: data } };
      }),
      def('getTrip', 'Get one trip owned by the signed-in customer. A trip identifier is optional when the conversation already has trip context.', objectSchema({ tripId: uuidSchema }), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'tripId')) throw new Error('Invalid tool arguments');
        const id = a.tripId === undefined ? c.conversationTripId : asUuid(a.tripId);
        if (!id) throw new Error('Trip context is required');
        const data = await this.trips.detail(c.customerId, id);
        return { text: JSON.stringify(data), messageType: 'TRIP_CARD', payload: { trip: data } };
      }),
      def('getVisaApplications', 'List visa applications for the signed-in customer.', objectSchema({ tripId: uuidSchema }), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'tripId')) throw new Error('Invalid tool arguments');
        const data = await this.visa.list(c.customerId, a.tripId === undefined ? undefined : asUuid(a.tripId));
        return { text: JSON.stringify(data), messageType: 'VISA_STATUS', payload: { applications: data } };
      }),
      def('getVisaApplication', 'Get a visa application and its requirement checklist owned by the signed-in customer.', objectSchema({ applicationId: uuidSchema }, ['applicationId']), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'applicationId')) throw new Error('Invalid tool arguments');
        const result = await this.visa.detail(c.customerId, asUuid(a.applicationId));
        const answers = result.answers ?? {};
        const data = { id: result.id, tripId: result.tripId, visaTypeName: result.visaTypeName, destinationCountryCode: result.destinationCountryCode,
          status: result.status, requiredCompleted: result.requiredCompleted, requiredTotal: result.requiredTotal,
          requirements: result.requirements.filter((item) => conditionMatches(item.conditionSnapshot,
            { ...(answers.application ?? {}), ...(answers[item.travellerId] ?? {}) }))
            .map((item) => ({ name: item.name, required: item.required, status: item.status })) };
        return { text: JSON.stringify(data), messageType: 'DOCUMENT_CHECKLIST', payload: data };
      }),
      def('getVisaStatus', 'Get current visa application statuses for the signed-in customer.', objectSchema({ tripId: uuidSchema }), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'tripId')) throw new Error('Invalid tool arguments');
        const data = await this.visa.list(c.customerId, a.tripId === undefined ? undefined : asUuid(a.tripId));
        return { text: JSON.stringify(data.map(({ id, tripId, visaTypeName, destinationCountryCode, status, requiredCompleted, requiredTotal }) => ({ id, tripId, visaTypeName, destinationCountryCode, status, requiredCompleted, requiredTotal }))), messageType: 'VISA_STATUS', payload: { applications: data } };
      }),
      def('getMissingDocuments', 'Find outstanding requirements in the signed-in customer visa applications. Returns checklist labels only, never document files.', objectSchema({ applicationId: uuidSchema }), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'applicationId')) throw new Error('Invalid tool arguments');
        const applications = a.applicationId === undefined ? await this.visa.list(c.customerId) : [await this.visa.detail(c.customerId, asUuid(a.applicationId))];
        const details = await Promise.all(applications.map((item) => this.visa.detail(c.customerId, item.id)));
        const data = details.map((item) => {
          const answers = item!.answers ?? {};
          return { visaTypeName: item!.visaTypeName, status: item!.status,
            requiredCompleted: item!.requiredCompleted, requiredTotal: item!.requiredTotal,
            missing: item!.requirements.filter((requirement) => requirement.required &&
              conditionMatches(requirement.conditionSnapshot, { ...(answers.application ?? {}), ...(answers[requirement.travellerId] ?? {}) }) &&
              ['MISSING', 'REVIEW_REQUIRED', 'REJECTED', 'REPLACEMENT_REQUIRED'].includes(requirement.status)).map((requirement) => requirement.name) };
        });
        return { text: JSON.stringify(data), messageType: 'DOCUMENT_CHECKLIST', payload: { applications: data } };
      }),
      def('getDocumentsSummary', 'Get document types, general status, and expiry dates for the signed-in customer. No file names, paths, URLs, or document contents are returned.', empty, async (c, a) => {
        strictEmpty(a); const docs = await this.documents.list(c.customerId, {});
        const data = docs.map(({ documentType, status, expiresOn }) => ({ documentType, status, expiresOn }));
        return { text: JSON.stringify(data), messageType: 'DOCUMENT_CHECKLIST', payload: { documents: data } };
      }),
      def('getOrders', 'List the signed-in customer orders with authoritative status and totals.', empty, async (c, a) => {
        strictEmpty(a); const data = await this.commerce.list(c.customerId);
        return { text: JSON.stringify(data), messageType: 'ORDER_STATUS', payload: { orders: data } };
      }),
      def('getOrder', 'Get one order owned by the signed-in customer.', objectSchema({ orderId: uuidSchema }, ['orderId']), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'orderId')) throw new Error('Invalid tool arguments');
        const { id, orderNumber, status, currency, totalAmount, paidAt, tripId, items, payment } = await this.commerce.detail(c.customerId, asUuid(a.orderId));
        const data = { id, orderNumber, status, currency, totalAmount, paidAt, tripId, items: items.map(({ description, quantity, totalAmount: amount, currency: cur }) => ({ description, quantity, amount, currency: cur })), payment: payment ? { status: payment.status, amount: payment.amount, currency: payment.currency, paidAt: payment.paidAt } : null };
        return { text: JSON.stringify(data), messageType: 'ORDER_STATUS', payload: data };
      }),
      def('getPaymentStatus', 'Get payment statuses for the signed-in customer. The payment service is the source of truth.', empty, async (c, a) => {
        strictEmpty(a); const data = await this.commerce.payments(c.customerId);
        return { text: JSON.stringify(data.map(({ id, orderId, status, amount, currency, paidAt, createdAt }) => ({ id, orderId, status, amount, currency, paidAt, createdAt }))), messageType: 'PAYMENT_STATUS', payload: { payments: data } };
      }),
      def('getBookingIntent', 'Get one flight selection/booking intent owned by the signed-in customer. This does not book or issue a ticket.', objectSchema({ intentId: uuidSchema }, ['intentId']), async (c, a) => {
        if (Object.keys(a).some((key) => key !== 'intentId')) throw new Error('Invalid tool arguments');
        const intent = await this.intents.detail(c.customerId, asUuid(a.intentId));
        const data = { id: intent.id, tripId: intent.tripId, status: intent.status, totalAmount: intent.validatedTotalAmount ?? intent.searchTotalAmount, currency: intent.currency, priceChanged: intent.priceChanged, validatedAt: intent.validatedAt };
        return { text: JSON.stringify(data), messageType: 'FLIGHT_RESULTS', payload: data };
      }),
      def('searchFlights', 'Search current live flights only when the customer explicitly asks for a new flight search. Supports one-way, return, and multi-city routes. Uses the existing Flyseri/Sabre search service and can incur supplier request cost.', objectSchema({ origin: { type: 'STRING', description: '3-letter airport code, or first leg origin' }, destination: { type: 'STRING', description: '3-letter airport code, or final leg destination' }, departureDate: { type: 'STRING', description: 'Travel date YYYY-MM-DD, or first leg date' }, returnDate: { type: 'STRING' }, tripType: { type: 'STRING', enum: ['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'] }, legs: { type: 'ARRAY', items: objectSchema({ origin: { type: 'STRING' }, destination: { type: 'STRING' }, departureDate: { type: 'STRING' } }, ['origin', 'destination', 'departureDate']) }, adults: { type: 'INTEGER' }, children: { type: 'INTEGER' }, infants: { type: 'INTEGER' }, cabin: { type: 'STRING', enum: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] }, currency: { type: 'STRING' }, tripId: uuidSchema }, ['origin', 'destination', 'departureDate', 'tripType', 'adults', 'children', 'infants', 'cabin', 'currency']), async (c, a) => {
        const allowed = ['origin', 'destination', 'departureDate', 'returnDate', 'tripType', 'legs', 'adults', 'children', 'infants', 'cabin', 'currency', 'tripId'];
        if (Object.keys(a).some((key) => !allowed.includes(key)) || !Number.isInteger(a.adults) || !Number.isInteger(a.children) || !Number.isInteger(a.infants)) throw new Error('Invalid flight search arguments');
        const dto = plainToInstance(FlightSearchDto, { ...a, ...(a.tripId === undefined && c.conversationTripId ? { tripId: c.conversationTripId } : {}) });
        if ((await validate(dto)).length) throw new ApiException('VALIDATION_ERROR', 'Please confirm the departure date including year, one-way or return, and the number of adults, children and infants before I search.', 400);
        const data = await this.flights.search(c.customerId, c.requestId, dto as FlightSearchRequest);
        return { text: JSON.stringify({ searchId: data.searchId, offers: data.offers }), messageType: 'FLIGHT_RESULTS', payload: data as unknown as Record<string, unknown> };
      }),
      {
        declaration: {
          name: 'requestHumanSupport',
          description: 'Prepare a support request only after the customer explicitly asks to contact a human. The system will show a confirmation card before creating the CRM event.',
          parameters: objectSchema({ reason: { type: 'STRING', description: 'Short customer-safe reason, no sensitive details', maxLength: 200 } }),
        },
        risk: 'CONFIRMATION_REQUIRED', requiresAuth: true, requiresConfirmation: true,
        handler: async () => ({ text: 'Confirmation is required.', messageType: 'CONFIRMATION' }),
      },
    ];
    if (this.mcp?.enabled) registry.push(def('searchHotels', 'Search Sabre CERT hotel availability near an airport only when the customer explicitly requests a hotel search. Ask for airport, stay dates and guest count first. Results are test availability, not bookable hotel offers. Never collect payment or guest identity details.', objectSchema({
      airport: { type: 'STRING', description: 'Three-letter airport code near the destination.' },
      checkInDate: { type: 'STRING', description: 'YYYY-MM-DD' }, checkOutDate: { type: 'STRING', description: 'YYYY-MM-DD' },
      adults: { type: 'INTEGER' }, childAges: { type: 'ARRAY', items: { type: 'INTEGER' } },
    }, ['airport', 'checkInDate', 'checkOutDate', 'adults']), async (c, a) => {
      const data = await this.mcp!.searchHotels(a, c.profile.preferredCurrency ?? 'MYR');
      return { text: JSON.stringify(data), messageType: 'TEXT', payload: data };
    }));
    this.tools = new Map(registry.map((tool) => [tool.declaration.name, tool]));
  }

  forRequest(explicitFlightSearch: boolean, allowWriteTools = false, explicitHotelSearch = false): AiFunctionDeclaration[] {
    return [...this.tools.values()].filter((tool) => (tool.declaration.name !== 'searchFlights' || explicitFlightSearch) &&
      (tool.declaration.name !== 'searchHotels' || explicitHotelSearch) &&
      (!(explicitFlightSearch || explicitHotelSearch) || ['getMyProfile', 'searchFlights', 'searchHotels', ...(allowWriteTools ? ['requestHumanSupport'] : [])].includes(tool.declaration.name)) &&
      (!tool.requiresConfirmation || allowWriteTools)).map((tool) => tool.declaration);
  }
  async execute(name: string, context: ToolContext, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool || tool.risk === 'HIGH_RISK_NOT_ALLOWED' || tool.requiresConfirmation) throw new Error('This action is unavailable.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
    return tool.handler(context, args as Args);
  }
}
