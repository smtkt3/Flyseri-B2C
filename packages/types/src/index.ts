export type DataSource = 'demo' | 'live';

export type FlightTripType = 'ONE_WAY' | 'ROUND_TRIP' | 'MULTI_CITY';
export type FlightCabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export interface FlightSearchLeg { origin: string; destination: string; departureDate: string; }
export interface FlightSearchRequest {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  tripType: FlightTripType;
  /** Ordered route legs, required only for multi-city searches. */
  legs?: FlightSearchLeg[];
  adults: number;
  children: number;
  infants: number;
  cabin: FlightCabin;
  currency: string;
  tripId?: string;
}
export interface FlightSegment {
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  marketingCarrier: string;
  flightNumber: string;
  durationMinutes: number | null;
  /** Booking class returned by shopping and required for Sabre itinerary revalidation. */
  bookingClass?: string;
  /** Supplier availability in the selected booking class, not aircraft capacity. */
  seatsAvailable?: number;
  /** Sabre equipment code when supplied by the flight schedule. */
  aircraftTypeCode?: string;
  operatingCarrier?: string;
}
export interface FlightLeg {
  segments: FlightSegment[];
  durationMinutes: number | null;
  stops: number;
}
export interface FlightBaggageAllowance {
  type: 'PERSONAL_ITEM' | 'CARRY_ON' | 'CHECKED';
  availability: 'INCLUDED' | 'FOR_FEE' | 'NOT_INCLUDED' | 'UNKNOWN';
  description: string | null;
  /** Zero-based segment positions from this complete Sabre itinerary; empty means itinerary-wide. */
  segmentIndexes: number[];
}
export interface FlightPenalty {
  type: 'REFUND' | 'CHANGE';
  applicability: 'BEFORE' | 'AFTER';
  allowed: boolean;
  amount: string | null;
  currency: string | null;
}
export interface FlightOffer {
  /** Supplier NDC context retained separately from the app's local offer UUID. */
  ndcContext?: { offerId: string; offerItemIds?: string[]; expiresAt: string; passengers: { passengerId: string; passengerTypeCode: 'ADT' | 'CNN' | 'INF' }[] };
  offerId: string;
  /** Groups fare alternatives returned for the same itinerary in one shopping response. */
  itineraryKey?: string;
  outbound: FlightLeg;
  inbound: FlightLeg | null;
  /** Additional ordered legs for a multi-city itinerary; outbound is still the first leg. */
  multiCityLegs?: FlightLeg[];
  totalAmount: string;
  /** Aggregate amounts for all travelers and legs, in the quoted currency. */
  priceBreakdown?: { baseFareAmount: string; taxesAndFeesAmount: string; currency: string; passengerPrices?: FlightPassengerPrice[] };
  currency: string;
  airlineCodes: string[];
  baggageSummary: string | null;
  baggageAllowances?: FlightBaggageAllowance[];
  penalties?: FlightPenalty[];
  nonRefundable?: boolean | null;
  cabin?: FlightCabin | 'MIXED' | null;
  fareBrand?: string | null;
  fareBrandCode?: string | null;
  baggageCharge?: { amount: string; currency: string; description: string | null } | null;
  amenities?: { category: 'WIFI' | 'ENTERTAINMENT' | 'MEALS' | 'BAGGAGE'; name: string;
    availability: 'INCLUDED' | 'FOR_FEE' | 'NOT_INCLUDED' | 'UNKNOWN';
    /** Zero-based itinerary segment positions; omitted for older itinerary-wide data. */
    segmentIndexes?: number[] }[];
}
export interface FlightPassengerPrice {
  passengerType: 'ADT' | 'CNN' | 'INF';
  count: number;
  baseFareAmount: string;
  taxesAndFeesAmount: string;
  totalAmount: string;
  currency: string;
}
export interface FlightAncillaryResponse {
  quoteId?: string;
  expiresAt?: string;
  retrievedAt: string;
  context?: 'SHOPPING_OFFER' | 'PRICED_OFFER' | 'NDC_ORDER' | 'ATPCO_SHOPPING';
  bookingAvailable: boolean;
  services: { offerItemId: string | null; sellable?: boolean | null; serviceCode: string; name: string;
    /** Airline service group, when supplied by Sabre (for example BG or ML). */
    groupCode?: string | null;
    amount: string | null; currency: string | null;
    segmentLabels: string[]; passengerIndexes: number[] }[];
}
export interface FlightAncillarySelectionInput { quoteId: string; serviceIndex: number }
export interface FlightAncillaryPurchaseItem {
  requestId: string;
  name: string;
  segmentLabels: string[];
  passengerIndexes: number[];
  airlineAmount: string;
  airlineCurrency: string;
  checkoutAmount: string;
  providerAncillaryIds: string[];
}
export interface FlightAncillaryPurchase {
  id: string;
  status: 'PREPARED' | 'ADDING' | 'CONFIRMED' | 'PRICE_CHANGED' | 'UNAVAILABLE' | 'SKIPPED' | 'UNKNOWN' | 'FULFILLMENT_PENDING' | 'FULFILLED';
  currency: string;
  airfareAmount: string;
  extrasAmount: string;
  totalAmount: string;
  expiresAt: string;
  items: FlightAncillaryPurchaseItem[];
  message?: string;
}
/** A selected airline quote saved with the booking; it is not an airline purchase. */
export interface FlightAncillaryRequest {
  id: string;
  name: string;
  serviceCode: string;
  groupCode?: string | null;
  category: 'FOOD' | 'BAGGAGE' | 'SEATS' | 'OTHER';
  segmentLabels: string[];
  passengerIndexes: number[];
  amount: string | null;
  currency: string | null;
  status: 'REQUESTED';
}
/** Display conversions only; supplier and payment amounts remain in their original currency. */
export interface FlightAncillaryDisplayPrices {
  currency: string;
  prices: (string | null)[];
  updatedAt: string | null;
  provider: 'ExchangeRate-API' | null;
}
export interface FlightSearchResponse {
  searchId: string;
  offers: FlightOffer[];
  source: 'sabre';
  searchedAt: string;
  expiresAt: string;
  incomplete?: boolean;
}
export interface AirportDirectoryEntry {
  code: string; city: string; name: string; country: string; type: string; scheduled: boolean; keywords: string;
  latitude?: number; longitude?: number; cityCenterName?: string; cityCenterLatitude?: number; cityCenterLongitude?: number;
  countryName: string; cityLabel: string;
}
export type FlightSearchEvent =
  | { type: 'results'; result: FlightSearchResponse; complete: boolean }
  /** result.offers contains only additions/changes; clients reconstruct the full snapshot. */
  | { type: 'delta'; result: FlightSearchResponse; removedOfferIds: string[]; complete: boolean }
  | { type: 'error'; code: string; message: string; requestId: string }
  | { type: 'started' };
export interface PopularCachedFlightFare {
  durationMinutes?: number | null;
  stops?: number;
  destination: string;
  departureDate: string;
  price: string;
  currency: string;
  searchedAt: string;
  expiresAt: string;
}

export type FlightBookingIntentStatus = 'CREATED' | 'VALIDATING' | 'VALIDATED' | 'PRICE_CHANGED' | 'EXPIRED' | 'READY_FOR_PAYMENT' | 'FAILED' | 'CANCELLED';
export interface FlightServicePreferences {
  meal: 'NONE' | 'VEGETARIAN' | 'VEGAN' | 'HALAL' | 'GLUTEN_FREE';
  baggage: 'NONE' | 'EXTRA_CHECKED';
  wheelchair: 'NONE' | 'AIRPORT' | 'STAIRS' | 'TO_SEAT';
  assistance: 'NONE' | 'HEARING' | 'VISION';
  note: string;
}
/** Customer requests for staff review, not confirmed airline services or purchases. */
export interface FlightServiceRequest extends FlightServicePreferences { travellerId: string }
export interface FlightBookingIntentInput {
  searchId: string;
  offerId: string;
  tripId?: string;
  travellerIds: string[];
  idempotencyKey: string;
  serviceRequests?: FlightServiceRequest[];
  ancillarySelections?: FlightAncillarySelectionInput[];
}
export interface FlightBookingIntent {
  ancillaryRequests?: FlightAncillaryRequest[];
  id: string;
  tripId: string | null;
  status: FlightBookingIntentStatus;
  selectedOffer: FlightOffer;
  /** Search criteria used for a server-side fare check. */
  searchRequest?: Omit<FlightSearchRequest, 'tripId'>;
  travellerIds: string[];
  serviceRequests?: FlightServiceRequest[];
  currency: string;
  searchTotalAmount: string;
  validatedTotalAmount: string | null;
  priceChanged: boolean;
  validatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus = 'PENDING_PAYMENT' | 'PAYMENT_PROCESSING' | 'PAID' | 'PAYMENT_FAILED' | 'EXPIRED' | 'CANCELLED';
export interface FlightBooking {
  ancillaryPurchase?: FlightAncillaryPurchase;
  ancillaryRequests?: FlightAncillaryRequest[];
  reconciliation?: {checkedAt:string;result:'NO_ACTIVE_MATCH'};
  failureMessage?: string;
  /** Owned order, when checkout has already been prepared for this reservation. */
  order?: { id: string; orderNumber: string; status: OrderStatus; expiresAt: string | null; paidAt: string | null };
  serviceRequests?: Array<FlightServiceRequest & { passengerName: string }>;
  passengerNamesSource?: 'BOOKED_SNAPSHOT' | 'CURRENT_PROFILES';
  id: string;
  bookingIntentId: string;
  tripId: string | null;
  status: string;
  pnr: string | null;
  currency: string;
  amount: string;
  selectedOffer: FlightOffer;
  passengerNames: string[];
  createdAt: string;
  updatedAt: string;
  lastSabreRefreshAt: string | null;
  ticketStatus: 'NOT_VERIFIED' | 'ISSUED';
  providerView?: FlightBookingProviderView;
}
export interface FlightBookingProviderView {
  retrievedAt: string;
  flights: Array<{airlineCode: string; flightNumber: string; origin: string; destination: string; departureDate: string; departureTime: string; arrivalDate: string; arrivalTime: string; status: string}>;
  travellers: Array<{givenName: string; surname: string}>;
  tickets: Array<{number: string; status: string; travellerIndex: number | null}>;
  cancellationCheckComplete: boolean;
}
export interface FlightReservationInput {
  contactEmail: string;
  contactPhone: string;
  namesConfirmed: boolean;
  passports?: Array<{ travellerId: string; documentType?: FlightIdentityDocumentType; documentNumber: string; expiryDate: string; issuingCountryCode: string }>;
  billingAddress: { name: string; street: string; city: string; stateProvince: string; postalCode: string; countryCode: string };
}
export type FlightIdentityDocumentType = 'PASSPORT' | 'NATIONAL_ID_CARD' | 'VISA' | 'ALIEN_RESIDENT' | 'BORDER_CROSSING_CARD' | 'REFUGEE_REENTRY_PERMIT';
export interface OrderSummary {
  id: string;
  orderNumber: string;
  tripId: string | null;
  bookingIntentId: string | null;
  visaApplicationId?: string | null;
  status: OrderStatus;
  fulfillmentStatus: 'NOT_STARTED' | 'REVALIDATION_REQUIRED' | 'COMPLETED';
  currency: string;
  totalAmount: string;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}
export interface OrderItem {
  id: string;
  itemType: 'FLIGHT' | 'VISA_SERVICE' | 'SERVICE_FEE';
  description: string;
  quantity: number;
  unitAmount: string;
  totalAmount: string;
  currency: string;
}
export interface PaymentSummary {
  id: string;
  provider?: string;
  orderId: string;
  status: 'CREATED' | 'PENDING' | 'PROCESSING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  reconciliationState: 'NONE' | 'REQUIRED' | 'RESOLVED';
  amount: string;
  currency: string;
  createdAt: string;
  paidAt: string | null;
}
export interface PaymentStartResult { payment: PaymentSummary; redirectUrl: string | null; actionRequired: boolean }
export interface OrderDetail extends OrderSummary {
  flightBookingId?: string | null;
  visaAssistanceRequestId?: string | null;
  items: OrderItem[];
  payment: PaymentSummary | null;
}
export interface OrderReceipt {
  orderNumber: string;
  paidAt: string;
  currency: string;
  totalAmount: string;
  items: OrderItem[];
  documentKind: 'PAYMENT_RECEIPT';
}

export interface RequestContext {
  requestId: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_SESSION'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'OFFER_EXPIRED'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiError;
}

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
  services?: {
    database: 'ok' | 'unavailable' | 'unconfigured';
    redis: 'ok' | 'unavailable' | 'unconfigured';
  };
}

export type CustomerStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type TravellerRelationship = 'SELF' | 'SPOUSE' | 'CHILD' | 'PARENT' | 'SIBLING' | 'RELATIVE' | 'FRIEND' | 'OTHER';
export type TravellerGender = 'FEMALE' | 'MALE' | 'X' | 'UNDISCLOSED';

export interface CustomerProfile {
  displayName: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  preferredLanguage: string | null;
  preferredCurrency: string | null;
}

export interface TravellerProfile {
  saveForFuture?: boolean;
  id: string;
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
  dateOfBirth: string | null;
  gender: TravellerGender | null;
  nationalityCountryCode: string | null;
  relationshipType: TravellerRelationship;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface TravellerPassport { documentNumber: string; expiryDate: string; issuingCountryCode: string }

export type TripStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export interface TripDestination {
  id: string;
  countryCode: string;
  cityName: string | null;
  sequence: number;
  startDate: string | null;
  endDate: string | null;
}
export interface TripTraveller {
  id: string;
  legalFirstName: string;
  legalLastName: string;
  relationshipType: TravellerRelationship;
}
export interface TripSummary {
  id: string;
  title: string | null;
  status: TripStatus;
  startDate: string | null;
  endDate: string | null;
  primaryDestination: Omit<TripDestination, 'id' | 'sequence' | 'startDate' | 'endDate'> | null;
  travellerCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface TripDetail extends TripSummary {
  destinations: TripDestination[];
  travellers: TripTraveller[];
}
export interface TripDestinationInput {
  countryCode: string;
  cityName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}
export interface TripInput {
  title?: string | null;
  status?: TripStatus;
  startDate?: string | null;
  endDate?: string | null;
  destinations?: TripDestinationInput[];
  travellerIds?: string[];
}

export type DocumentType = 'PASSPORT' | 'NATIONAL_ID' | 'PASSPORT_PHOTO' | 'RESIDENCE_PERMIT' | 'BANK_STATEMENT' | 'EMPLOYMENT_LETTER' | 'MARRIAGE_CERTIFICATE' | 'BIRTH_CERTIFICATE' | 'COMPANY_DOCUMENT' | 'PREVIOUS_VISA' | 'TRAVEL_DOCUMENT' | 'OTHER';
export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'REVIEW_REQUIRED' | 'ARCHIVED';
export type DocumentScanStatus = 'PENDING' | 'CLEAN' | 'FAILED' | 'UNAVAILABLE';
export type DocumentUploadState = 'PENDING' | 'UPLOADED' | 'FAILED';
export interface DocumentVersion {
  id: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  securityScanStatus: DocumentScanStatus;
  uploadedAt: string | null;
}
export interface DocumentSummary {
  id: string;
  travellerId: string | null;
  travellerName: string | null;
  documentType: DocumentType;
  displayName: string | null;
  status: DocumentStatus;
  issuedOn: string | null;
  expiresOn: string | null;
  issuingCountryCode: string | null;
  currentVersion: DocumentVersion | null;
  createdAt: string;
  updatedAt: string;
}
export interface DocumentDetail extends DocumentSummary { versions: DocumentVersion[] }
export interface DocumentInput {
  travellerId?: string | null;
  documentType: DocumentType;
  displayName?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  issuingCountryCode?: string | null;
}
export interface DocumentAccess { url: string; expiresInSeconds: number }

export type SeriMessageType = 'TEXT' | 'TRIP_CARD' | 'FLIGHT_RESULTS' | 'VISA_STATUS' | 'DOCUMENT_CHECKLIST' | 'ORDER_STATUS' | 'PAYMENT_STATUS' | 'CONFIRMATION' | 'SUPPORT_HANDOFF';
export interface SeriConversationSummary { id: string; tripId: string | null; title: string | null; createdAt: string; updatedAt: string; lastMessageAt: string }
export interface SeriMessage { id: string; role: 'USER' | 'ASSISTANT'; content: string; messageType: SeriMessageType; payload: Record<string, unknown> | null; createdAt: string }
export interface SeriTurnResponse { conversation: SeriConversationSummary; message: SeriMessage; deterministic: boolean; provider: 'GEMINI' | 'OPENAI' | null; promptVersion: string }
export interface SeriPendingAction { id: string; toolName: string; summary: string; expiresAt: string; status: 'PENDING' | 'CONFIRMED' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED' | 'FAILED' }
export interface SeriAiMetrics { conversationsToday: number; requests: number; deterministicResponses: number; llmRequests: number; primaryRequests: number; fallbackRequests: number; toolCalls: number; toolFailures: number; averageLatencyMs: number; inputTokens: number | null; outputTokens: number | null; confirmationsCreated: number; confirmationsExecuted: number; supportHandoffs: number; pricingConfigured: boolean }

export type VisaFieldType = 'TEXT' | 'TEXTAREA' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'DATE' | 'YEAR' | 'SELECT' | 'MULTI_SELECT' | 'RADIO' | 'CHECKBOX' | 'COUNTRY' | 'ADDRESS' | 'PASSPORT' | 'YES_NO';
export interface VisaFieldCondition { field: string; operator: 'EQ' | 'NEQ' | 'IN'; value: string | string[] }
export interface VisaFormField {
  key: string;
  label: string;
  helpText?: string | null;
  required: boolean;
  type: VisaFieldType;
  placeholder?: string | null;
  options?: Array<{ label: string; value: string }>;
  validation?: { minLength?: number; maxLength?: number; min?: number; max?: number; pattern?: string };
  visibleWhen?: VisaFieldCondition[];
  applicantScope?: 'APPLICANT' | 'APPLICATION';
}
export interface VisaFormSection { key: string; label: string; displayOrder: number; fields: VisaFormField[] }
export interface VisaFeeComponent { code: string; label: string; amount: string; currency: string }
export interface VisaFormDefinition { sections: VisaFormSection[] }
export interface VisaType {
  id: string; destinationCountryCode: string; code: string; name: string; description: string | null;
  processingTimeText?: string | null; currency?: string | null; validityText?: string | null; entryType?: string | null;
  version?: number; governmentFeeAmount?: string | null; serviceFeeAmount?: string | null; nationalityEligibility?: string[];
  otherFeeComponents?: Array<{ code: string; label: string; amount: string }>; notes?: string | null; disclaimers?: string[];
}
export type VisaApplicationStatus = 'DRAFT' | 'INCOMPLETE' | 'READY_TO_SUBMIT' | 'SUBMITTED' | 'AWAITING_PAYMENT' | 'PAYMENT_CONFIRMING' | 'PAYMENT_FAILED' | 'PAID' | 'DOCUMENT_REVIEW' | 'ADDITIONAL_DOCUMENTS_REQUIRED' | 'APPLICATION_PREPARATION' | 'READY_FOR_SUBMISSION_TO_AUTHORITY' | 'SUBMITTED_TO_EMBASSY_OR_AUTHORITY' | 'UNDER_PROCESSING' | 'ADDITIONAL_INFORMATION_REQUIRED' | 'APPROVED' | 'VISA_ISSUED' | 'REJECTED' | 'COMPLETED' | 'DOCUMENTS_SUBMITTED' | 'CANCELLED';
export type VisaRequirementStatus = 'MISSING' | 'UPLOADED' | 'UNDER_REVIEW' | 'REVIEW_REQUIRED' | 'ACCEPTED' | 'REJECTED' | 'REPLACEMENT_REQUIRED' | 'NOT_APPLICABLE';
export interface VisaTimelineItem { id: string; status: VisaApplicationStatus; label: string; customerMessage: string | null; createdAt: string }
export interface VisaReviewRequest { id: string; requirementId: string | null; travellerId: string | null; fieldKey: string | null; requestType: 'DOCUMENT' | 'ANSWER' | 'ADDITIONAL_INFO'; reason: string; dueAt: string | null; status: 'OPEN' | 'RESOLVED' | 'CANCELLED'; createdAt: string }
export interface VisaCustomerUpdate { id: string; message: string; createdAt: string }
export interface VisaRequirementDocument { documentId: string; documentVersionId: string; documentType: DocumentType; displayName: string | null;
  originalFilename: string; versionNumber: number; securityScanStatus: DocumentScanStatus; uploadState: DocumentUploadState }
export interface VisaApplicationRequirement {
  id: string;
  travellerId: string;
  requirementCode: string;
  name: string;
  description: string | null;
  required: boolean;
  documentType: DocumentType | null;
  status: VisaRequirementStatus;
  displayOrder: number;
  conditionSnapshot?: VisaFieldCondition[];
  documents: VisaRequirementDocument[];
}
export interface VisaApplicationSummary {
  id: string;
  applicationReference?: string;
  tripId: string;
  visaTypeId: string;
  visaTypeName: string;
  destinationCountryCode: string;
  status: VisaApplicationStatus;
  travellerIds: string[];
  requiredCompleted: number;
  requiredTotal: number;
  createdAt: string;
  updatedAt: string;
  paymentStatus?: PaymentSummary['status'] | null;
  feeSnapshot?: VisaFeeComponent[];
}
export interface VisaApplicationDetail extends VisaApplicationSummary {
  requirements: VisaApplicationRequirement[];
  formSnapshot?: VisaFormDefinition;
  answers?: Record<string, Record<string, unknown>>;
  serviceSnapshot?: Record<string, unknown> | null;
  declarationVersion?: string | null;
  declarationAcceptedAt?: string | null;
  timeline?: VisaTimelineItem[];
  reviewRequests?: VisaReviewRequest[];
  customerUpdates?: VisaCustomerUpdate[];
  orderId?: string | null;
}
export type VisaAssistanceRequestStatus = 'NEW' | 'IN_REVIEW' | 'CONTACTED' | 'CONVERTED' | 'CLOSED';
export interface VisaAssistanceAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
}
export type VisaAssistanceDocumentType = 'PASSPORT' | 'TRAVEL_DOCUMENT' | 'NATIONAL_ID';
export interface VisaAssistanceApplicantInput {
  travellerId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: string;
  gender: TravellerGender;
  nationalityCountryCode: string;
  birthCity?: string;
  birthCountryCode: string;
  documentType: VisaAssistanceDocumentType;
  documentNumber: string;
  documentIssuingCountryCode: string;
  documentIssuedOn?: string;
  documentExpiresOn: string;
  currentAddress: VisaAssistanceAddress;
  permanentAddress: VisaAssistanceAddress;
  occupation?: string;
  employerOrSchool?: string;
  previousVisaRefusal?: 'YES' | 'NO' | 'PREFER_TO_DISCUSS';
  notes?: string;
}
export interface VisaAssistanceRequestInput {
  tripId: string;
  destinationCountryCode: string;
  expectedTravelDate: string;
  purpose: string;
  applicants: VisaAssistanceApplicantInput[];
  expectedReturnDate?: string;
  accommodationOrHost?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  customerMessage?: string;
}
export interface VisaAssistanceRequestSummary {
  id: string;
  requestReference: string;
  tripId: string;
  destinationCountryCode: string;
  expectedTravelDate: string;
  purpose: string;
  status: VisaAssistanceRequestStatus;
  createdAt: string;
}
export interface VisaAssistanceAdminRequest extends VisaAssistanceRequestSummary {
  customerId: string;
  customerName: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  customerMessage: string | null;
  travellerIds: string[];
}
export interface VisaAssistanceAdminRequestDetail extends VisaAssistanceAdminRequest {
  documents: VisaAssistanceDocument[];
  applicants: Array<{ travellerId: string; details: VisaAssistanceApplicantInput | null }>;
  expectedReturnDate: string | null;
  accommodationOrHost: string | null;
}

export interface VisaAssistanceDocument {
 id: string; travellerId: string; documentId: string; documentVersionId: string;
 filename: string; documentType: DocumentType; fileSize: number; scanStatus: string;
}
export interface VisaAssistanceRequestDetail extends VisaAssistanceRequestSummary {
 contactName: string; contactEmail: string; contactPhone: string | null;
 expectedReturnDate: string | null; accommodationOrHost: string | null; customerMessage: string | null;
 applicants: Array<{ travellerId: string; details: VisaAssistanceApplicantInput | null }>;
 documents: VisaAssistanceDocument[];
}
export type { HolidayPackage, HolidayBookingInput, HolidayBooking } from './holiday.js';
export type { FareWatch, SupportStage, SupportUpdate, TravelSupportRequest } from './travel.js';
