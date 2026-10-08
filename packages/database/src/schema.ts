import { foreignKey, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const holidayPackages = pgTable('holiday_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  definition: jsonb('definition').notNull(),
  version: integer('version').notNull().default(1),
  published: boolean('published').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('holiday_packages_published_idx').on(table.published), check('holiday_packages_version_valid', sql`${table.version} > 0`)]);

export const holidayBookings = pgTable('holiday_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reference: varchar('reference', { length: 32 }).notNull().unique(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  packageId: uuid('package_id').notNull().references(() => holidayPackages.id),
  packageSnapshot: jsonb('package_snapshot').notNull(),
  request: jsonb('request').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  totalMinor: numeric('total_minor', { precision: 16, scale: 0 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('PENDING_CONFIRMATION'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('holiday_bookings_customer_key_unique').on(table.customerId, table.idempotencyKey), index('holiday_bookings_customer_idx').on(table.customerId, table.createdAt), check('holiday_bookings_total_positive', sql`${table.totalMinor} > 0`), check('holiday_bookings_status_valid', sql`${table.status} in ('PENDING_CONFIRMATION','CONFIRMED','CANCELLED')`)]);

/** Admin configured fee for the general assisted visa intake. Orders retain their price snapshot. */
export const visaAssistanceFeeSettings = pgTable('visa_assistance_fee_settings', {
  id: varchar('id', {length: 32}).primaryKey().default('default'),
  amount: numeric('amount', {precision: 18, scale: 2}).notNull(),
  currency: varchar('currency', {length: 3}).notNull(),
  basis: varchar('basis', {length: 16}).notNull(),
  active: boolean('active').notNull().default(false),
  updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
}, table => [
  check('visa_assistance_fee_id_valid', sql`${table.id} = 'default'`),
  check('visa_assistance_fee_amount_valid', sql`${table.amount} > 0 and ${table.amount} <= 9999999`),
  check('visa_assistance_fee_currency_valid', sql`${table.currency} in ('MYR','USD','SGD','EUR','GBP','AUD')`),
  check('visa_assistance_fee_basis_valid', sql`${table.basis} in ('APPLICATION','APPLICANT')`),
]);

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  authUserId: uuid('auth_user_id').notNull(),
  displayName: varchar('display_name', { length: 120 }),
  phoneCountryCode: varchar('phone_country_code', { length: 8 }),
  phoneNumber: varchar('phone_number', { length: 24 }),
  preferredLanguage: varchar('preferred_language', { length: 12 }),
  preferredCurrency: varchar('preferred_currency', { length: 3 }),
  status: varchar('status', { length: 12 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('customers_auth_user_id_unique').on(table.authUserId),
  check('customers_status_valid', sql`${table.status} in ('ACTIVE', 'SUSPENDED', 'ARCHIVED')`),
]);

export const travellers = pgTable('travellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalFirstName: varchar('legal_first_name', { length: 100 }).notNull(),
  legalMiddleName: varchar('legal_middle_name', { length: 100 }),
  legalLastName: varchar('legal_last_name', { length: 100 }).notNull(),
  dateOfBirth: date('date_of_birth', { mode: 'string' }),
  gender: varchar('gender', { length: 16 }),
  nationalityCountryCode: varchar('nationality_country_code', { length: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  index('travellers_archived_at_idx').on(table.archivedAt),
  check('travellers_gender_valid', sql`${table.gender} is null or ${table.gender} in ('FEMALE', 'MALE', 'X', 'UNDISCLOSED')`),
]);

export const customerTravellers = pgTable('customer_travellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  travellerId: uuid('traveller_id').notNull().references(() => travellers.id),
  relationshipType: varchar('relationship_type', { length: 12 }).notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('customer_travellers_unique').on(table.customerId, table.travellerId),
  uniqueIndex('customer_travellers_one_primary').on(table.customerId).where(sql`${table.isPrimary} = true`),
  index('customer_travellers_customer_idx').on(table.customerId),
  index('customer_travellers_traveller_idx').on(table.travellerId),
  check('customer_travellers_relationship_valid', sql`${table.relationshipType} in ('SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'RELATIVE', 'FRIEND', 'OTHER')`),
]);

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  title: varchar('title', { length: 160 }),
  status: varchar('status', { length: 12 }).notNull().default('PLANNING'),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  index('trips_customer_status_idx').on(table.customerId, table.status),
  index('trips_customer_start_idx').on(table.customerId, table.startDate),
  check('trips_status_valid', sql`${table.status} in ('PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED')`),
  check('trips_dates_valid', sql`${table.startDate} is null or ${table.endDate} is null or ${table.endDate} >= ${table.startDate}`),
]);

export const tripDestinations = pgTable('trip_destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  countryCode: varchar('country_code', { length: 2 }).notNull(),
  cityName: varchar('city_name', { length: 120 }),
  sequence: integer('sequence').notNull(),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('trip_destinations_trip_sequence_unique').on(table.tripId, table.sequence),
  check('trip_destinations_sequence_valid', sql`${table.sequence} > 0`),
  check('trip_destinations_dates_valid', sql`${table.startDate} is null or ${table.endDate} is null or ${table.endDate} >= ${table.startDate}`),
]);

export const tripTravellers = pgTable('trip_travellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  travellerId: uuid('traveller_id').notNull().references(() => travellers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('trip_travellers_unique').on(table.tripId, table.travellerId),
  index('trip_travellers_traveller_idx').on(table.travellerId),
]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  travellerId: uuid('traveller_id').references(() => travellers.id),
  documentType: varchar('document_type', { length: 32 }).notNull(),
  displayName: varchar('display_name', { length: 160 }),
  status: varchar('status', { length: 20 }).notNull().default('UPLOADED'),
  issuedOn: date('issued_on', { mode: 'string' }),
  expiresOn: date('expires_on', { mode: 'string' }),
  issuingCountryCode: varchar('issuing_country_code', { length: 2 }),
  nextVersion: integer('next_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  index('documents_customer_idx').on(table.customerId),
  index('documents_customer_traveller_idx').on(table.customerId, table.travellerId),
  index('documents_customer_type_idx').on(table.customerId, table.documentType),
  check('documents_next_version_valid', sql`${table.nextVersion} > 0`),
  check('documents_dates_valid', sql`${table.issuedOn} is null or ${table.expiresOn} is null or ${table.expiresOn} >= ${table.issuedOn}`),
  check('documents_status_valid', sql`${table.status} in ('UPLOADED', 'PROCESSING', 'READY', 'REVIEW_REQUIRED', 'ARCHIVED')`),
]);

export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  storagePath: text('storage_path').notNull(),
  originalFilename: varchar('original_filename', { length: 180 }).notNull(),
  mimeType: varchar('mime_type', { length: 32 }).notNull(),
  fileSize: integer('file_size').notNull(),
  checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
  versionNumber: integer('version_number').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  uploadState: varchar('upload_state', { length: 12 }).notNull().default('PENDING'),
  securityScanStatus: varchar('security_scan_status', { length: 12 }).notNull().default('UNAVAILABLE'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('document_versions_number_unique').on(table.documentId, table.versionNumber),
  uniqueIndex('document_versions_idempotency_unique').on(table.documentId, table.idempotencyKey),
  uniqueIndex('document_versions_path_unique').on(table.storagePath),
  index('document_versions_document_idx').on(table.documentId),
  check('document_versions_number_valid', sql`${table.versionNumber} > 0`),
  check('document_versions_size_valid', sql`${table.fileSize} > 0`),
  check('document_versions_upload_valid', sql`${table.uploadState} in ('PENDING', 'UPLOADED', 'FAILED')`),
  check('document_versions_scan_valid', sql`${table.securityScanStatus} in ('PENDING', 'CLEAN', 'FAILED', 'UNAVAILABLE')`),
]);

export const visaTypes = pgTable('visa_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  destinationCountryCode: varchar('destination_country_code', { length: 2 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('visa_types_country_code_unique').on(table.destinationCountryCode, table.code)]);

/** Immutable, versioned commercial and form configuration for one visa service. */
export const visaServiceVersions = pgTable('visa_service_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  visaTypeId: uuid('visa_type_id').notNull().references(() => visaTypes.id),
  version: integer('version').notNull(),
  active: boolean('active').notNull().default(false),
  nationalityEligibility: jsonb('nationality_eligibility').$type<string[]>().notNull().default([]),
  processingTimeText: varchar('processing_time_text', { length: 240 }),
  governmentFeeAmount: numeric('government_fee_amount', { precision: 12, scale: 2 }),
  serviceFeeAmount: numeric('service_fee_amount', { precision: 12, scale: 2 }),
  otherFeeComponents: jsonb('other_fee_components').$type<Array<{ code: string; label: string; amount: string }>>().notNull().default([]),
  currency: varchar('currency', { length: 3 }),
  validityText: varchar('validity_text', { length: 240 }),
  entryType: varchar('entry_type', { length: 24 }),
  notes: text('notes'),
  disclaimers: jsonb('disclaimers').$type<string[]>().notNull().default([]),
  formDefinition: jsonb('form_definition').$type<Record<string, unknown>>().notNull().default({ sections: [] }),
  effectiveFrom: date('effective_from', { mode: 'string' }),
  effectiveUntil: date('effective_until', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('visa_service_versions_type_version_unique').on(table.visaTypeId, table.version),
  index('visa_service_versions_active_idx').on(table.visaTypeId, table.active),
  check('visa_service_versions_version_valid', sql`${table.version} > 0`),
  check('visa_service_versions_currency_valid', sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`),
  check('visa_service_versions_fees_nonnegative', sql`(${table.governmentFeeAmount} is null or ${table.governmentFeeAmount} >= 0) and (${table.serviceFeeAmount} is null or ${table.serviceFeeAmount} >= 0)`),
  check('visa_service_versions_dates_valid', sql`${table.effectiveFrom} is null or ${table.effectiveUntil} is null or ${table.effectiveUntil} >= ${table.effectiveFrom}`),
]);

/** Customer enquiries for Flyseri's assisted visa service, before a formal service quote exists. */
export const visaAssistanceRequests = pgTable('visa_assistance_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestReference: varchar('request_reference', { length: 24 }).notNull()
    .default(sql`'FVA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  destinationCountryCode: varchar('destination_country_code', { length: 2 }).notNull(),
  expectedTravelDate: date('expected_travel_date', { mode: 'string' }).notNull(),
  expectedReturnDate: date('expected_return_date', { mode: 'string' }),
  purpose: varchar('purpose', { length: 80 }).notNull(),
  accommodationOrHost: varchar('accommodation_or_host', { length: 240 }),
  contactName: varchar('contact_name', { length: 120 }).notNull(),
  contactEmail: varchar('contact_email', { length: 254 }).notNull(),
  contactPhone: varchar('contact_phone', { length: 32 }),
  customerMessage: text('customer_message'),
  status: varchar('status', { length: 20 }).notNull().default('NEW'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('visa_assistance_requests_reference_unique').on(table.requestReference),
  index('visa_assistance_requests_customer_created_idx').on(table.customerId, table.createdAt),
  index('visa_assistance_requests_status_created_idx').on(table.status, table.createdAt),
  check('visa_assistance_requests_country_valid', sql`${table.destinationCountryCode} ~ '^[A-Z]{2}$'`),
  check('visa_assistance_requests_return_date_valid', sql`${table.expectedReturnDate} is null or ${table.expectedReturnDate} >= ${table.expectedTravelDate}`),
  check('visa_assistance_requests_status_valid', sql`${table.status} in ('NEW', 'IN_REVIEW', 'CONTACTED', 'CONVERTED', 'CLOSED')`),
]);

export const visaAssistanceRequestTravellers = pgTable('visa_assistance_request_travellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => visaAssistanceRequests.id),
  travellerId: uuid('traveller_id').notNull().references(() => travellers.id),
  applicantDetails: jsonb('applicant_details').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('visa_assistance_request_travellers_unique').on(table.requestId, table.travellerId),
  index('visa_assistance_request_travellers_traveller_idx').on(table.travellerId),
]);

export const visaRequirements = pgTable('visa_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  visaTypeId: uuid('visa_type_id').notNull().references(() => visaTypes.id),
  requirementCode: varchar('requirement_code', { length: 64 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  description: text('description'),
  documentTypeRequired: varchar('document_type_required', { length: 32 }),
  required: boolean('required').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  active: boolean('active').notNull().default(false),
  nationalityCountryCode: varchar('nationality_country_code', { length: 2 }),
  residenceCountryCode: varchar('residence_country_code', { length: 2 }),
  applicantCategory: varchar('applicant_category', { length: 32 }),
  minAge: integer('min_age'),
  maxAge: integer('max_age'),
  effectiveFrom: date('effective_from', { mode: 'string' }),
  effectiveUntil: date('effective_until', { mode: 'string' }),
  conditions: jsonb('conditions').$type<Array<{ field: string; operator: 'EQ' | 'NEQ' | 'IN'; value: string | string[] }>>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('visa_requirements_type_code_unique').on(table.visaTypeId, table.requirementCode),
  index('visa_requirements_type_active_idx').on(table.visaTypeId, table.active),
  check('visa_requirements_age_valid', sql`${table.minAge} is null or ${table.maxAge} is null or ${table.maxAge} >= ${table.minAge}`),
  check('visa_requirements_effective_valid', sql`${table.effectiveFrom} is null or ${table.effectiveUntil} is null or ${table.effectiveUntil} >= ${table.effectiveFrom}`),
]);

export const visaApplications = pgTable('visa_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationReference: varchar('application_reference', { length: 24 }).notNull()
    .default(sql`'FSV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  tripId: uuid('trip_id').notNull().references(() => trips.id),
  visaTypeId: uuid('visa_type_id').notNull().references(() => visaTypes.id),
  serviceVersionId: uuid('service_version_id').references(() => visaServiceVersions.id),
  destinationCountryCode: varchar('destination_country_code', { length: 2 }).notNull(),
  serviceSnapshot: jsonb('service_snapshot').$type<Record<string, unknown>>(),
  formSnapshot: jsonb('form_snapshot').$type<Record<string, unknown>>().notNull().default({ sections: [] }),
  answers: jsonb('answers').$type<Record<string, Record<string, unknown>>>().notNull().default({}),
  feeSnapshot: jsonb('fee_snapshot').$type<Array<{ code: string; label: string; amount: string; currency: string }>>().notNull().default([]),
  declarationVersion: varchar('declaration_version', { length: 32 }),
  declarationAcceptedAt: timestamp('declaration_accepted_at', { withTimezone: true }),
  status: varchar('status', { length: 40 }).notNull().default('DRAFT'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('visa_applications_reference_unique').on(table.applicationReference),
  index('visa_applications_customer_idx').on(table.customerId),
  index('visa_applications_trip_idx').on(table.tripId),
  check('visa_applications_status_valid', sql`${table.status} in ('DRAFT', 'INCOMPLETE', 'READY_TO_SUBMIT', 'SUBMITTED', 'AWAITING_PAYMENT', 'PAYMENT_CONFIRMING', 'PAYMENT_FAILED', 'PAID', 'DOCUMENT_REVIEW', 'ADDITIONAL_DOCUMENTS_REQUIRED', 'APPLICATION_PREPARATION', 'READY_FOR_SUBMISSION_TO_AUTHORITY', 'SUBMITTED_TO_EMBASSY_OR_AUTHORITY', 'UNDER_PROCESSING', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'VISA_ISSUED', 'REJECTED', 'COMPLETED', 'DOCUMENTS_SUBMITTED', 'CANCELLED')`),
]);

export const visaApplicationTravellers = pgTable('visa_application_travellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => visaApplications.id),
  travellerId: uuid('traveller_id').notNull().references(() => travellers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('visa_application_travellers_unique').on(table.applicationId, table.travellerId)]);

export const visaApplicationRequirements = pgTable('visa_application_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => visaApplications.id),
  travellerId: uuid('traveller_id').notNull().references(() => travellers.id),
  sourceRequirementId: uuid('source_requirement_id').references(() => visaRequirements.id),
  requirementCode: varchar('requirement_code', { length: 64 }).notNull(),
  nameSnapshot: varchar('name_snapshot', { length: 160 }).notNull(),
  descriptionSnapshot: text('description_snapshot'),
  requiredSnapshot: boolean('required_snapshot').notNull(),
  documentTypeSnapshot: varchar('document_type_snapshot', { length: 32 }),
  conditionSnapshot: jsonb('condition_snapshot').$type<Array<{ field: string; operator: 'EQ' | 'NEQ' | 'IN'; value: string | string[] }>>().notNull().default([]),
  displayOrder: integer('display_order').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('MISSING'),
  reviewNote: text('review_note'),
  reviewedByStaffId: uuid('reviewed_by_staff_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('visa_application_requirements_unique').on(table.applicationId, table.travellerId, table.requirementCode),
  index('visa_application_requirements_app_idx').on(table.applicationId),
  check('visa_application_requirements_status_valid', sql`${table.status} in ('MISSING', 'UPLOADED', 'UNDER_REVIEW', 'REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED', 'REPLACEMENT_REQUIRED', 'NOT_APPLICABLE')`),
]);

export const visaReviewRequests = pgTable('visa_review_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => visaApplications.id),
  applicationRequirementId: uuid('application_requirement_id').references(() => visaApplicationRequirements.id),
  travellerId: uuid('traveller_id').references(() => travellers.id),
  fieldKey: varchar('field_key', { length: 120 }),
  requestType: varchar('request_type', { length: 24 }).notNull(),
  reason: text('reason').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  status: varchar('status', { length: 12 }).notNull().default('OPEN'),
  requestedByStaffId: uuid('requested_by_staff_id').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('visa_review_requests_app_idx').on(table.applicationId, table.status),
  check('visa_review_requests_type_valid', sql`${table.requestType} in ('DOCUMENT', 'ANSWER', 'ADDITIONAL_INFO')`),
  check('visa_review_requests_status_valid', sql`${table.status} in ('OPEN', 'RESOLVED', 'CANCELLED')`),
]);

export const visaApplicationNotes = pgTable('visa_application_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => visaApplications.id),
  staffUserId: uuid('staff_user_id').notNull(),
  visibility: varchar('visibility', { length: 12 }).notNull().default('INTERNAL'),
  note: text('note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('visa_application_notes_app_idx').on(table.applicationId, table.createdAt),
  check('visa_application_notes_visibility_valid', sql`${table.visibility} in ('INTERNAL', 'CUSTOMER')`),
]);

export const visaRequirementDocuments = pgTable('visa_requirement_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationRequirementId: uuid('application_requirement_id').notNull().references(() => visaApplicationRequirements.id),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  documentVersionId: uuid('document_version_id').notNull().references(() => documentVersions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('visa_requirement_documents_unique').on(table.applicationRequirementId, table.documentVersionId),
  index('visa_requirement_documents_requirement_idx').on(table.applicationRequirementId),
]);

export const visaStatusHistory = pgTable('visa_status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => visaApplications.id),
  fromStatus: varchar('from_status', { length: 40 }),
  toStatus: varchar('to_status', { length: 40 }).notNull(),
  actorType: varchar('actor_type', { length: 16 }).notNull(),
  actorCustomerId: uuid('actor_customer_id').references(() => customers.id),
  actorStaffUserId: uuid('actor_staff_user_id'),
  reasonCode: varchar('reason_code', { length: 64 }),
  customerMessage: text('customer_message'),
  internalNote: text('internal_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('visa_status_history_app_idx').on(table.applicationId)]);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorCustomerId: uuid('actor_customer_id').notNull().references(() => customers.id),
  travellerId: uuid('traveller_id').references(() => travellers.id),
  tripId: uuid('trip_id').references(() => trips.id),
  documentId: uuid('document_id').references(() => documents.id),
  visaApplicationId: uuid('visa_application_id').references(() => visaApplications.id),
  event: text('event').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('audit_events_actor_idx').on(table.actorCustomerId)]);

export const adminAuditEvents = pgTable('admin_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffUserId: uuid('staff_user_id').notNull(),
  staffRole: varchar('staff_role', { length: 24 }).notNull(),
  event: varchar('event', { length: 80 }).notNull(),
  resourceType: varchar('resource_type', { length: 40 }).notNull(),
  resourceId: uuid('resource_id').notNull(),
  requestId: varchar('request_id', { length: 80 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('admin_audit_events_created_idx').on(table.createdAt)]);

/** A customer selection, not an airline reservation or payment. */
export const flightBookingIntents = pgTable('flight_booking_intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  tripId: uuid('trip_id').references(() => trips.id),
  searchId: uuid('search_id').notNull(),
  selectedOfferId: uuid('selected_offer_id').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  status: varchar('status', { length: 24 }).notNull().default('CREATED'),
  supplier: varchar('supplier', { length: 16 }).notNull().default('SABRE'),
  currency: varchar('currency', { length: 3 }).notNull(),
  searchTotalAmount: varchar('search_total_amount', { length: 24 }).notNull(),
  validatedTotalAmount: varchar('validated_total_amount', { length: 24 }),
  priceChanged: boolean('price_changed').notNull().default(false),
  // Only Flyseri's normalized, customer-safe shopping DTOs are persisted here.
  selectedOfferSnapshot: jsonb('selected_offer_snapshot').notNull(),
  searchRequestSnapshot: jsonb('search_request_snapshot').notNull(),
  serviceRequests: jsonb('service_requests').notNull().default(sql`'[]'::jsonb`),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('flight_booking_intents_customer_idempotency_unique').on(table.customerId, table.idempotencyKey),
  index('flight_booking_intents_customer_created_idx').on(table.customerId, table.createdAt),
  index('flight_booking_intents_trip_idx').on(table.tripId),
  check('flight_booking_intents_status_valid', sql`${table.status} in ('CREATED', 'VALIDATING', 'VALIDATED', 'PRICE_CHANGED', 'EXPIRED', 'READY_FOR_PAYMENT', 'FAILED', 'CANCELLED')`),
  check('flight_booking_intents_supplier_valid', sql`${table.supplier} = 'SABRE'`),
  check('flight_booking_intents_service_requests_valid', sql`case when jsonb_typeof(${table.serviceRequests}) = 'array' then jsonb_array_length(${table.serviceRequests}) <= 9 else false end`),
  check('flight_booking_intents_currency_valid', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check('flight_booking_intents_amount_valid', sql`${table.searchTotalAmount} ~ '^[0-9]+(\\.[0-9]{1,2})?$' and (${table.validatedTotalAmount} is null or ${table.validatedTotalAmount} ~ '^[0-9]+(\\.[0-9]{1,2})?$')`),
]);

export const flightBookingIntentTravellers = pgTable('flight_booking_intent_travellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingIntentId: uuid('booking_intent_id').notNull().references(() => flightBookingIntents.id),
  travellerId: uuid('traveller_id').notNull().references(() => travellers.id),
  passengerType: varchar('passenger_type', { length: 3 }).notNull().default('ADT'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('flight_booking_intent_travellers_unique').on(table.bookingIntentId, table.travellerId),
  index('flight_booking_intent_travellers_traveller_idx').on(table.travellerId),
  check('flight_booking_intent_travellers_passenger_type_valid', sql`${table.passengerType} in ('ADT', 'CHD', 'INF')`),
]);

/** A Sabre reservation is distinct from the customer selection, order and issued tickets. */
export const flightBookings = pgTable('flight_bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingIntentId: uuid('booking_intent_id').notNull().references(() => flightBookingIntents.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  tripId: uuid('trip_id').references(() => trips.id),
  status: varchar('status', { length: 28 }).notNull().default('BOOKING_PENDING'),
  pnrLocator: varchar('pnr_locator', { length: 16 }),
  sabreBookingId: varchar('sabre_booking_id', { length: 80 }),
  lastSabreRefreshAt: timestamp('last_sabre_refresh_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('flight_bookings_intent_unique').on(table.bookingIntentId),
  uniqueIndex('flight_bookings_pnr_unique').on(table.pnrLocator).where(sql`${table.pnrLocator} is not null`),
  index('flight_bookings_customer_created_idx').on(table.customerId, table.createdAt),
  index('flight_bookings_status_updated_idx').on(table.status, table.updatedAt),
  check('flight_bookings_status_valid', sql`${table.status} in ('BOOKING_PENDING', 'BOOKING_IN_PROGRESS', 'BOOKING_UNKNOWN', 'PNR_CREATED', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'AWAITING_STAFF_TICKETING', 'TICKETING_IN_PROGRESS', 'TICKETED', 'BOOKING_FAILED', 'PNR_EXPIRED', 'FARE_CHANGED', 'PAYMENT_FAILED', 'MANUAL_REVIEW_REQUIRED', 'TICKETING_FAILED', 'CANCELLED', 'REFUND_REQUIRED')`),
]);

/** A guest's submitted checkout details, before a reservation or payment exists. No ID documents are stored here. */
export const guestFlightCheckoutAttempts = pgTable('guest_flight_checkout_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  searchId: uuid('search_id').notNull(),
  offerId: uuid('offer_id').notNull(),
  contactName: varchar('contact_name', { length: 120 }).notNull(),
  contactEmail: varchar('contact_email', { length: 254 }).notNull(),
  contactPhone: varchar('contact_phone', { length: 24 }).notNull(),
  passengerNames: jsonb('passenger_names').$type<string[]>().notNull(),
  route: varchar('route', { length: 320 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  shoppingAmount: numeric('shopping_amount', { precision: 18, scale: 2 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('DETAILS_SUBMITTED'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('guest_flight_checkout_attempts_key_unique').on(table.idempotencyKey),
  index('guest_flight_checkout_attempts_created_idx').on(table.createdAt),
  check('guest_flight_checkout_attempts_status_valid', sql`${table.status} in ('DETAILS_SUBMITTED')`),
  check('guest_flight_checkout_attempts_currency_valid', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check('guest_flight_checkout_attempts_amount_valid', sql`${table.shoppingAmount} >= 0`),
]);

/** Commercial snapshot. One flight selection can create only one order. */
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  tripId: uuid('trip_id').references(() => trips.id),
  bookingIntentId: uuid('booking_intent_id').references(() => flightBookingIntents.id),
  visaApplicationId: uuid('visa_application_id').references(() => visaApplications.id),
  orderNumber: varchar('order_number', { length: 32 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('PENDING_PAYMENT'),
  fulfillmentStatus: varchar('fulfillment_status', { length: 32 }).notNull().default('NOT_STARTED'),
  currency: varchar('currency', { length: 3 }).notNull(),
  subtotalAmount: numeric('subtotal_amount', { precision: 18, scale: 2 }).notNull(),
  feesAmount: numeric('fees_amount', { precision: 18, scale: 2 }).notNull().default('0.00'),
  discountAmount: numeric('discount_amount', { precision: 18, scale: 2 }).notNull().default('0.00'),
  taxAmount: numeric('tax_amount', { precision: 18, scale: 2 }).notNull().default('0.00'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 2 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('orders_number_unique').on(table.orderNumber),
  uniqueIndex('orders_booking_intent_unique').on(table.bookingIntentId),
  uniqueIndex('orders_visa_application_unique').on(table.visaApplicationId),
  index('orders_customer_created_idx').on(table.customerId, table.createdAt),
  index('orders_trip_idx').on(table.tripId),
  check('orders_status_valid', sql`${table.status} in ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED')`),
  check('orders_fulfillment_valid', sql`${table.fulfillmentStatus} in ('NOT_STARTED', 'REVALIDATION_REQUIRED', 'COMPLETED')`),
  check('orders_source_valid', sql`${table.bookingIntentId} is null or ${table.visaApplicationId} is null`),
  check('orders_currency_valid', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check('orders_amounts_valid', sql`${table.subtotalAmount} >= 0 and ${table.feesAmount} >= 0 and ${table.discountAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.totalAmount} >= 0 and ${table.totalAmount} = ${table.subtotalAmount} + ${table.feesAmount} + ${table.taxAmount} - ${table.discountAmount}`),
]);

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  itemType: varchar('item_type', { length: 24 }).notNull(),
  referenceId: uuid('reference_id'),
  descriptionSnapshot: varchar('description_snapshot', { length: 240 }).notNull(),
  quantity: integer('quantity').notNull(),
  unitAmount: numeric('unit_amount', { precision: 18, scale: 2 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('order_items_order_idx').on(table.orderId),
  check('order_items_type_valid', sql`${table.itemType} in ('FLIGHT', 'VISA_SERVICE', 'SERVICE_FEE')`),
  check('order_items_amount_valid', sql`${table.quantity} > 0 and ${table.unitAmount} >= 0 and ${table.totalAmount} = ${table.quantity} * ${table.unitAmount}`),
  check('order_items_currency_valid', sql`${table.currency} ~ '^[A-Z]{3}$'`),
]);

/** Provider funds are authoritative only after a verified event or status check. */
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  provider: varchar('provider', { length: 32 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('CREATED'),
  reconciliationState: varchar('reconciliation_state', { length: 12 }).notNull().default('NONE'),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  providerPaymentId: varchar('provider_payment_id', { length: 160 }),
  providerReference: varchar('provider_reference', { length: 160 }),
  authorizedAt: timestamp('authorized_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('payments_order_unique').on(table.orderId),
  uniqueIndex('payments_provider_payment_unique').on(table.provider, table.providerPaymentId).where(sql`${table.providerPaymentId} is not null`),
  index('payments_customer_created_idx').on(table.customerId, table.createdAt),
  index('payments_reconciliation_idx').on(table.reconciliationState, table.updatedAt),
  check('payments_status_valid', sql`${table.status} in ('CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')`),
  check('payments_reconciliation_valid', sql`${table.reconciliationState} in ('NONE', 'REQUIRED', 'RESOLVED')`),
  check('payments_amount_valid', sql`${table.amount} > 0`),
  check('payments_currency_valid', sql`${table.currency} ~ '^[A-Z]{3}$'`),
]);

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  idempotencyKey: uuid('idempotency_key').notNull(),
  provider: varchar('provider', { length: 32 }).notNull(),
  providerAttemptReference: varchar('provider_attempt_reference', { length: 160 }),
  status: varchar('status', { length: 24 }).notNull().default('CREATED'),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  failureCategory: varchar('failure_category', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('payment_attempts_key_unique').on(table.paymentId, table.idempotencyKey),
  uniqueIndex('payment_attempts_one_active').on(table.paymentId).where(sql`${table.status} in ('CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN')`),
  index('payment_attempts_payment_created_idx').on(table.paymentId, table.createdAt),
  check('payment_attempts_status_valid', sql`${table.status} in ('CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')`),
  check('payment_attempts_amount_valid', sql`${table.amount} > 0`),
]);

export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  provider: varchar('provider', { length: 32 }).notNull(),
  providerEventId: varchar('provider_event_id', { length: 160 }).notNull(),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  verified: boolean('verified').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('payment_events_provider_event_unique').on(table.provider, table.providerEventId),
  index('payment_events_payment_received_idx').on(table.paymentId, table.receivedAt),
]);

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('REQUESTED'),
  reasonCode: varchar('reason_code', { length: 64 }).notNull(),
  providerRefundId: varchar('provider_refund_id', { length: 160 }),
  requestedByStaffId: uuid('requested_by_staff_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('refunds_payment_idx').on(table.paymentId),
  check('refunds_amount_valid', sql`${table.amount} > 0`),
  check('refunds_status_valid', sql`${table.status} in ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')`),
]);

/** Durable integration boundary; no Sabre fulfillment is dispatched in Phase 7. */
export const commerceOutbox = pgTable('commerce_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  orderId: uuid('order_id').references(() => orders.id),
  paymentId: uuid('payment_id').references(() => payments.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [index('commerce_outbox_unprocessed_idx').on(table.processedAt, table.createdAt)]);

export const commerceAuditEvents = pgTable('commerce_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorType: varchar('actor_type', { length: 12 }).notNull(),
  actorCustomerId: uuid('actor_customer_id').references(() => customers.id),
  orderId: uuid('order_id').references(() => orders.id),
  paymentId: uuid('payment_id').references(() => payments.id),
  event: varchar('event', { length: 80 }).notNull(),
  requestId: varchar('request_id', { length: 80 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('commerce_audit_order_created_idx').on(table.orderId, table.createdAt),
  check('commerce_audit_actor_valid', sql`${table.actorType} in ('CUSTOMER', 'PROVIDER', 'SYSTEM')`),
]);

/** References only: CRM keeps its own contacts and never owns Flyseri customer data. */
export const crmCustomerLinks = pgTable('crm_customer_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  crmContactId: uuid('crm_contact_id').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('LINKED'),
  linkMethod: varchar('link_method', { length: 24 }).notNull().default('STAFF_CONFIRMED'),
  linkedByStaffId: uuid('linked_by_staff_id').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('crm_customer_links_active_customer').on(table.customerId).where(sql`${table.status} = 'LINKED'`),
  uniqueIndex('crm_customer_links_active_contact').on(table.crmContactId).where(sql`${table.status} = 'LINKED'`),
  index('crm_customer_links_customer_idx').on(table.customerId),
  check('crm_customer_links_status_valid', sql`${table.status} in ('LINKED', 'UNLINKED')`),
]);

/** Durable queue; only safe IDs and event names cross the CRM service boundary. */
export const crmSyncEvents = pgTable('crm_sync_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  resourceId: uuid('resource_id'),
  sourceAuditId: uuid('source_audit_id'),
  sourceCommerceId: uuid('source_commerce_id'),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  lastErrorCategory: varchar('last_error_category', { length: 32 }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('crm_sync_source_audit_unique').on(table.sourceAuditId).where(sql`${table.sourceAuditId} is not null`),
  uniqueIndex('crm_sync_source_commerce_unique').on(table.sourceCommerceId).where(sql`${table.sourceCommerceId} is not null`),
  index('crm_sync_due_idx').on(table.status, table.nextAttemptAt),
  check('crm_sync_status_valid', sql`${table.status} in ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD')`),
  check('crm_sync_attempts_valid', sql`${table.attempts} >= 0 and ${table.attempts} <= 5`),
]);

export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  tripId: uuid('trip_id').references(() => trips.id),
  status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('ai_conversations_customer_idx').on(table.customerId, table.lastMessageAt)]);

export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id),
  role: varchar('role', { length: 16 }).notNull(),
  content: text('content').notNull(),
  messageType: varchar('message_type', { length: 32 }).notNull().default('TEXT'),
  payload: jsonb('payload').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('ai_messages_conversation_idx').on(table.conversationId, table.createdAt), check('ai_messages_role_valid', sql`${table.role} in ('USER', 'ASSISTANT', 'SYSTEM')`)]);

export const aiToolCalls = pgTable('ai_tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id),
  messageId: uuid('message_id').references(() => aiMessages.id),
  toolName: varchar('tool_name', { length: 80 }).notNull(),
  riskLevel: varchar('risk_level', { length: 24 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  requestId: uuid('request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('ai_tool_calls_conversation_idx').on(table.conversationId, table.createdAt)]);

export const aiPendingActions = pgTable('ai_pending_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id),
  tripId: uuid('trip_id').references(() => trips.id),
  toolName: varchar('tool_name', { length: 80 }).notNull(),
  validatedArguments: jsonb('validated_arguments').$type<Record<string, unknown>>().notNull(),
  riskLevel: varchar('risk_level', { length: 24 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (table) => [index('ai_pending_actions_customer_idx').on(table.customerId, table.status), check('ai_pending_action_status_valid', sql`${table.status} in ('PENDING', 'CONFIRMED', 'EXECUTED', 'EXPIRED', 'CANCELLED', 'FAILED')`)]);

export const aiUsageEvents = pgTable('ai_usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').references(() => customers.id),
  conversationId: uuid('conversation_id').references(() => aiConversations.id),
  requestId: uuid('request_id'),
  provider: varchar('provider', { length: 16 }),
  providerTier: varchar('provider_tier', { length: 16 }),
  model: varchar('model', { length: 120 }),
  requestKind: varchar('request_kind', { length: 24 }).notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms').notNull().default(0),
  success: boolean('success').notNull().default(true),
  promptVersion: varchar('prompt_version', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('ai_usage_events_created_idx').on(table.createdAt, table.requestKind)]);

export const visaAssistanceRequestDocuments = pgTable('visa_assistance_request_documents', {
 id: uuid('id').primaryKey().defaultRandom(),
 requestId: uuid('request_id').notNull().references(() => visaAssistanceRequests.id),
 travellerId: uuid('traveller_id').notNull().references(() => travellers.id),
 documentId: uuid('document_id').notNull().references(() => documents.id),
 documentVersionId: uuid('document_version_id').notNull().references(() => documentVersions.id),
 createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
 uniqueIndex('visa_assistance_documents_version_unique').on(table.requestId, table.documentVersionId),
 index('visa_assistance_documents_request_idx').on(table.requestId),
 foreignKey({ columns: [table.requestId, table.travellerId], foreignColumns: [visaAssistanceRequestTravellers.requestId, visaAssistanceRequestTravellers.travellerId], name: 'visa_assistance_documents_applicant_fk' }),
]);
