import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import type { Pool } from 'pg';
import { parseConfig } from '@flyseri/config';
import type { FlyseriLogger } from '@flyseri/logging';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { CUSTOMER_STORE, DOCUMENT_STORAGE, DOCUMENT_STORE, TOKEN_VERIFIER, TRIP_STORE, VISA_STORE } from './tokens.js';
import { DrizzleCustomerStore } from './customer/customer.repository.js';
import { DrizzleTripStore } from './trip/trip.repository.js';
import { DrizzleDocumentStore } from './document/document.repository.js';
import { DrizzleVisaStore } from './visa/visa.repository.js';
import { AdminRecordsService } from './admin/admin-records.service.js';
import { AdminVisaService } from './admin/admin-visa.service.js';

const aliceId = randomUUID();
const bobId = randomUUID();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x31, 0x32, 0x33]);

describe('private documents and visa applications', () => {
  let app: INestApplication;
  let database: ReturnType<typeof newDb>;
  let aliceTraveller: string;
  let secondTraveller: string;
  let bobTraveller: string;
  let tripId: string;
  let bobTripId: string;
  let documentId: string;
  let bobDocumentId: string;
  let visaTypeId: string;
  let applicationId: string;
  let firstVersionId: string;
  let documentStore: DrizzleDocumentStore;
  let adminRecords: AdminRecordsService;
  let adminVisa: AdminVisaService;
  const logs: unknown[] = [];
  const storage = {
    upload: vi.fn(async (_path: string, _bytes: Buffer, _mime: string) => undefined),
    remove: vi.fn(async (_path: string) => undefined),
    signedUrl: vi.fn(async (_path: string, _seconds: number, _download: boolean) => 'https://private.example/short?secret=never-log'),
  };

  beforeAll(async () => {
    process.env.APP_ENV = 'test'; process.env.DOCUMENT_MAX_UPLOAD_MB = '1';
    delete process.env.DATABASE_URL; delete process.env.REDIS_URL;
    database = newDb();
    database.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true });
    for (const filename of ['0000_mean_ultimates.sql', '0001_nasty_thor.sql', '0003_famous_stranger.sql', '0005_mighty_blob.sql', '0007_kind_lady_bullseye.sql']) {
      const migration = readFileSync(resolve(process.cwd(), '../../packages/database/drizzle', filename), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) database.public.none(statement);
    }
    // This API integration fixture intentionally uses pg-mem and only the legacy
    // document chain. Add the Phase 10.75 columns/tables in memory; never migrate a
    // configured database from this test.
    for (const statement of [
      "CREATE TABLE visa_service_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visa_type_id uuid NOT NULL, version integer NOT NULL, active boolean NOT NULL DEFAULT false, nationality_eligibility jsonb NOT NULL DEFAULT '[]', processing_time_text varchar(240), government_fee_amount numeric(12,2), service_fee_amount numeric(12,2), other_fee_components jsonb NOT NULL DEFAULT '[]', currency varchar(3), validity_text varchar(240), entry_type varchar(24), notes text, disclaimers jsonb NOT NULL DEFAULT '[]', form_definition jsonb NOT NULL DEFAULT '{\"sections\":[]}', effective_from date, effective_until date, created_at timestamptz NOT NULL DEFAULT now())",
      "ALTER TABLE visa_applications ADD COLUMN application_reference varchar(24) NOT NULL DEFAULT 'FSV-TEST'",
      'ALTER TABLE visa_applications ADD COLUMN service_version_id uuid',
      'ALTER TABLE visa_applications DROP CONSTRAINT visa_applications_status_valid',
      'ALTER TABLE visa_applications ALTER COLUMN status TYPE varchar(40)',
      'ALTER TABLE visa_status_history ALTER COLUMN from_status TYPE varchar(40)',
      'ALTER TABLE visa_status_history ALTER COLUMN to_status TYPE varchar(40)',
      'ALTER TABLE visa_applications ADD COLUMN service_snapshot jsonb',
      "ALTER TABLE visa_applications ADD COLUMN form_snapshot jsonb NOT NULL DEFAULT '{\"sections\":[]}'",
      "ALTER TABLE visa_applications ADD COLUMN answers jsonb NOT NULL DEFAULT '{}'",
      "ALTER TABLE visa_applications ADD COLUMN fee_snapshot jsonb NOT NULL DEFAULT '[]'",
      'ALTER TABLE visa_applications ADD COLUMN declaration_version varchar(32)',
      'ALTER TABLE visa_applications ADD COLUMN declaration_accepted_at timestamptz',
      "ALTER TABLE visa_requirements ADD COLUMN conditions jsonb NOT NULL DEFAULT '[]'",
      "ALTER TABLE visa_application_requirements ADD COLUMN condition_snapshot jsonb NOT NULL DEFAULT '[]'",
      'ALTER TABLE visa_application_requirements ADD COLUMN review_note text',
      'ALTER TABLE visa_application_requirements ADD COLUMN reviewed_by_staff_id uuid',
      'ALTER TABLE visa_application_requirements ADD COLUMN reviewed_at timestamptz',
      'ALTER TABLE visa_status_history ADD COLUMN actor_staff_user_id uuid',
      'ALTER TABLE visa_status_history ADD COLUMN customer_message text',
      'ALTER TABLE visa_status_history ADD COLUMN internal_note text',
      "CREATE TABLE orders (id uuid PRIMARY KEY, visa_application_id uuid, status varchar(24) NOT NULL DEFAULT 'PENDING_PAYMENT', total_amount numeric(18,2), currency varchar(3), created_at timestamptz DEFAULT now())",
      'CREATE TABLE payments (order_id uuid, status varchar(24), paid_at timestamptz)',
      "CREATE TABLE visa_review_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL, application_requirement_id uuid, traveller_id uuid, field_key varchar(120), request_type varchar(24) NOT NULL, reason text NOT NULL, due_at timestamptz, status varchar(12) NOT NULL DEFAULT 'OPEN', requested_by_staff_id uuid NOT NULL, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())",
      "CREATE TABLE visa_application_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL, staff_user_id uuid NOT NULL, visibility varchar(12) NOT NULL DEFAULT 'INTERNAL', note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
      "CREATE TABLE admin_audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_user_id uuid NOT NULL, staff_role varchar(24) NOT NULL, event varchar(80) NOT NULL, resource_type varchar(40) NOT NULL, resource_id uuid NOT NULL, request_id varchar(80) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
    ]) database.public.none(statement);
    const adapter = database.adapters.createPg();
    for (const prototype of [adapter.Pool.prototype, adapter.Client.prototype]) {
      const original = prototype.query as unknown as (...args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      Object.defineProperty(prototype, 'query', { value: async function (query: unknown, ...args: unknown[]) {
        if (typeof query === 'object' && query !== null && ('types' in query || 'rowMode' in query)) {
          const { types: _types, rowMode, ...withoutOptions } = query as Record<string, unknown>;
          const result = await original.call(this, withoutOptions, ...args);
          return rowMode === 'array' ? { ...result, rows: result.rows.map((row) => Object.values(row)) } : result;
        }
        return original.call(this, query, ...args);
      } });
    }
    const connection = { db: drizzle(new adapter.Pool() as unknown as Pool, { schema }) } as unknown as DatabaseConnection;
    adminRecords = new AdminRecordsService(connection);
    adminVisa = new AdminVisaService(connection);
    const verifier = { verify: vi.fn(async (token: string) => token === 'alice' ? { authUserId: aliceId } : token === 'bob' ? { authUserId: bobId } : null) };
    documentStore = new DrizzleDocumentStore(connection);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CUSTOMER_STORE).useValue(new DrizzleCustomerStore(connection))
      .overrideProvider(TRIP_STORE).useValue(new DrizzleTripStore(connection))
      .overrideProvider(DOCUMENT_STORE).useValue(documentStore)
      .overrideProvider(VISA_STORE).useValue(new DrizzleVisaStore(connection))
      .overrideProvider(DOCUMENT_STORAGE).useValue(storage)
      .overrideProvider(TOKEN_VERIFIER).useValue(verifier).compile();
    app = module.createNestApplication();
    const logger = { info: vi.fn((entry: unknown) => logs.push(entry)), error: vi.fn((entry: unknown) => logs.push(entry)) } as unknown as FlyseriLogger;
    configureApp(app, parseConfig(process.env), logger);
    await app.init();
    const person = async (token: string, first: string, relationshipType = 'SELF') => (await request(app.getHttpServer()).post('/api/v1/travellers').set(bearer(token)).send({ legalFirstName: first, legalLastName: 'Test', relationshipType }).expect(201)).body.data.id as string;
    aliceTraveller = await person('alice', 'Ain'); secondTraveller = await person('alice', 'Fatimah', 'SPOUSE'); bobTraveller = await person('bob', 'Bob');
    tripId = (await request(app.getHttpServer()).post('/api/v1/trips').set(bearer('alice')).send({ destinations: [{ countryCode: 'JP' }], travellerIds: [aliceTraveller, secondTraveller] }).expect(201)).body.data.id as string;
    bobTripId = (await request(app.getHttpServer()).post('/api/v1/trips').set(bearer('bob')).send({ destinations: [{ countryCode: 'JP' }], travellerIds: [bobTraveller] }).expect(201)).body.data.id as string;
    visaTypeId = randomUUID(); const requirementId = randomUUID();
    database.public.none("insert into visa_service_versions (visa_type_id, version, active, form_definition) values ('" + visaTypeId + "', 1, true, '{\"sections\":[{\"key\":\"applicant\",\"label\":\"Applicant\",\"fields\":[{\"key\":\"first_name\",\"label\":\"First name\",\"type\":\"TEXT\",\"required\":true,\"applicantScope\":\"APPLICANT\"}]}]}')");
    database.public.none(`insert into visa_types (id, destination_country_code, code, name, active) values ('${visaTypeId}', 'JP', 'TEST', 'Test tourist visa', true)`);
    database.public.none(`insert into visa_requirements (id, visa_type_id, requirement_code, name, document_type_required, active) values ('${requirementId}', '${visaTypeId}', 'PASSPORT', 'Passport copy', 'PASSPORT', true)`);
  });
  afterAll(async () => { await app?.close(); delete process.env.DOCUMENT_MAX_UPLOAD_MB; });

  it('requires authentication and validates document ownership', async () => {
    await request(app.getHttpServer()).post(`/api/v1/documents/${randomUUID()}/versions`).expect(401);
    await request(app.getHttpServer()).post('/api/v1/documents').set(bearer('alice')).send({ documentType: 'PASSPORT' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/documents').set(bearer('alice')).send({ documentType: 'PASSPORT', travellerId: bobTraveller }).expect(400);
    documentId = (await request(app.getHttpServer()).post('/api/v1/documents').set(bearer('alice')).send({ documentType: 'PASSPORT', travellerId: aliceTraveller, expiresOn: '2031-05-14' }).expect(201)).body.data.id as string;
    bobDocumentId = (await request(app.getHttpServer()).post('/api/v1/documents').set(bearer('bob')).send({ documentType: 'PASSPORT', travellerId: bobTraveller }).expect(201)).body.data.id as string;
    const list = await request(app.getHttpServer()).get('/api/v1/documents').set(bearer('alice')).expect(200);
    expect(list.body.data.map((item: { id: string }) => item.id)).toEqual([documentId]);
    for (const method of ['get', 'patch', 'delete'] as const) {
      const route = `/api/v1/documents/${documentId}`;
      if (method === 'patch') await request(app.getHttpServer()).patch(route).set(bearer('bob')).send({ displayName: 'Stolen' }).expect(404);
      else await request(app.getHttpServer())[method](route).set(bearer('bob')).expect(404);
    }
    await request(app.getHttpServer()).get(`/api/v1/documents/${documentId}/access-url`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/documents/${documentId}/versions`).set(bearer('bob')).set('Idempotency-Key', randomUUID()).attach('file', jpeg, { filename: 'stolen.jpg', contentType: 'image/jpeg' }).expect(404);
    expect(JSON.stringify(list.body.data)).not.toContain('storagePath');
    expect(JSON.stringify(list.body.data)).not.toContain('publicUrl');
  });

  it('rejects invalid files and keeps filenames out of storage paths', async () => {
    const before = storage.upload.mock.calls.length;
    await request(app.getHttpServer()).post(`/api/v1/documents/${documentId}/versions`).set(bearer('alice')).set('Idempotency-Key', randomUUID()).attach('file', Buffer.from('not a PDF'), { filename: 'fake.pdf', contentType: 'application/pdf' }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/documents/${documentId}/versions`).set(bearer('alice')).set('Idempotency-Key', randomUUID()).attach('file', Buffer.alloc(1024 * 1024 + 1), { filename: 'large.pdf', contentType: 'application/pdf' }).expect(413);
    expect(storage.upload.mock.calls).toHaveLength(before);
    const key = randomUUID();
    const uploaded = await request(app.getHttpServer()).post(`/api/v1/documents/${documentId}/versions`).set(bearer('alice')).set('Idempotency-Key', key).attach('file', jpeg, { filename: '../../passport-A123.jpg', contentType: 'image/jpeg' }).expect(201);
    firstVersionId = uploaded.body.data.currentVersion.id as string;
    expect(uploaded.body.data.currentVersion.securityScanStatus).toBe('UNAVAILABLE');
    expect(uploaded.body.data.currentVersion.originalFilename).not.toContain('../');
    const path = storage.upload.mock.calls.at(-1)?.[0] ?? '';
    expect(path).not.toContain('passport-A123');
    expect(path).toMatch(new RegExp(`^customers/[0-9a-f-]+/documents/${documentId}/versions/[0-9a-f-]+\\.jpg$`));
    const retry = await request(app.getHttpServer()).post(`/api/v1/documents/${documentId}/versions`).set(bearer('alice')).set('Idempotency-Key', key).attach('file', jpeg, { filename: '../../passport-A123.jpg', contentType: 'image/jpeg' }).expect(201);
    expect(retry.body.data.versions).toHaveLength(1);
    expect(storage.upload.mock.calls).toHaveLength(before + 1);
  });

  it('keeps replaced versions and only grants short lived audited access to the owner', async () => {
    const replaced = await request(app.getHttpServer()).post(`/api/v1/documents/${documentId}/versions`).set(bearer('alice')).set('Idempotency-Key', randomUUID()).attach('file', jpeg, { filename: 'new.jpg', contentType: 'image/jpeg' }).expect(201);
    expect(replaced.body.data.versions).toHaveLength(2);
    expect(replaced.body.data.currentVersion.versionNumber).toBe(2);
    const access = await request(app.getHttpServer()).get(`/api/v1/documents/${documentId}/versions/${firstVersionId}/access-url?download=true`).set(bearer('alice')).expect(200);
    expect(access.body.data.expiresInSeconds).toBe(60);
    expect(storage.signedUrl).toHaveBeenCalledWith(expect.any(String), 60, true);
    expect(JSON.stringify(logs)).not.toContain('never-log');
    expect(JSON.stringify(database.public.many('select * from document_versions'))).not.toContain('never-log');
    await request(app.getHttpServer()).get(`/api/v1/documents/${documentId}/versions/${firstVersionId}/access-url`).set(bearer('bob')).expect(404);
    expect(database.public.many(`select id from audit_events where document_id = '${documentId}' and event = 'document.downloaded'`)).toHaveLength(1);
  });

  it('cleans up a storage object when database finalization fails', async () => {
    const before = storage.remove.mock.calls.length;
    vi.spyOn(documentStore, 'complete').mockRejectedValueOnce(new Error('database finalization failed'));
    await request(app.getHttpServer()).post(`/api/v1/documents/${documentId}/versions`).set(bearer('alice')).set('Idempotency-Key', randomUUID()).attach('file', jpeg, { filename: 'retry.jpg', contentType: 'image/jpeg' }).expect(503);
    expect(storage.remove.mock.calls).toHaveLength(before + 1);
    const failed = database.public.one(`select upload_state from document_versions where document_id = '${documentId}' order by version_number desc limit 1`);
    expect(failed.upload_state).toBe('FAILED');
    const visible = await request(app.getHttpServer()).get(`/api/v1/documents/${documentId}`).set(bearer('alice')).expect(200);
    expect(visible.body.data.versions).toHaveLength(2);
  });

  it('starts an owned visa application with an immutable per-traveller requirement snapshot', async () => {
    await request(app.getHttpServer()).get('/api/v1/visa-services?countryCode=JP').expect(401);
    const catalogue = await request(app.getHttpServer()).get('/api/v1/visa-services?countryCode=JP').set(bearer('alice')).expect(200);
    expect(catalogue.body.data).toEqual([expect.objectContaining({ id: visaTypeId, name: 'Test tourist visa', destinationCountryCode: 'JP' })]);
    await request(app.getHttpServer()).get('/api/v1/visa-services?countryCode=XYZ').set(bearer('alice')).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/trips/${bobTripId}/visa-applications`).set(bearer('alice')).send({ visaTypeId, travellerIds: [aliceTraveller] }).expect(404);
    const count = database.public.many('select id from visa_applications').length;
    await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/visa-applications`).set(bearer('alice')).send({ visaTypeId, travellerIds: [bobTraveller] }).expect(400);
    expect(database.public.many('select id from visa_applications')).toHaveLength(count);
    const notOnTrip = (await request(app.getHttpServer()).post('/api/v1/travellers').set(bearer('alice')).send({ legalFirstName: 'Not', legalLastName: 'OnTrip', relationshipType: 'OTHER' }).expect(201)).body.data.id as string;
    await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/visa-applications`).set(bearer('alice')).send({ visaTypeId, travellerIds: [notOnTrip] }).expect(400);
    const created = await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/visa-applications`).set(bearer('alice')).send({ visaTypeId, travellerIds: [aliceTraveller, secondTraveller] }).expect(201);
    applicationId = created.body.data.id as string;
    expect(created.body.data.requirements).toHaveLength(2);
    expect(created.body.data.requiredTotal).toBe(2);
    database.public.none("update visa_requirements set name = 'Changed later' where requirement_code = 'PASSPORT'");
    const detail = await request(app.getHttpServer()).get(`/api/v1/visa-applications/${applicationId}`).set(bearer('alice')).expect(200);
    expect(detail.body.data.requirements.map((item: { name: string }) => item.name)).toEqual(['Passport copy', 'Passport copy']);
    expect(database.public.many(`select id from visa_status_history where application_id = '${applicationId}'`)).toHaveLength(1);
  });

  it('exposes a useful low-PII staff queue row with the saved application reference and checklist counts', async () => {
    const result = await adminRecords.visas({ page: 1, limit: 20, search: 'FSV-TEST' });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: applicationId, applicationReference: 'FSV-TEST',
      destinationCountryCode: 'JP', status: 'DRAFT', requiredDocumentsReceived: 0, requiredDocumentsTotal: 2,
      paymentStatus: null, orderStatus: null, openCorrectionCount: 0,
    });
    expect(result.items[0]).toHaveProperty('applicants');
    expect(result.items[0]).not.toHaveProperty('answers');
    const filtered = await adminRecords.visas({ page: 1, limit: 20, search: 'Ain', status: 'DRAFT',
      createdFrom: new Date(Date.now() - 60_000).toISOString(), createdTo: new Date(Date.now() + 60_000).toISOString(), actionRequired: false });
    expect(filtered.total).toBe(1);
    expect((await adminRecords.visas({ page: 1, limit: 20, paymentStatus: 'SUCCEEDED' })).total).toBe(0);
  });

  it('routes requested answer corrections to the information state and resolves the exact field update', async () => {
    const created = await request(app.getHttpServer()).post(`/api/v1/trips/${tripId}/visa-applications`).set(bearer('alice'))
      .send({ visaTypeId, travellerIds: [aliceTraveller, secondTraveller] }).expect(201);
    const correctionApplicationId = created.body.data.id as string;
    database.public.none(`update visa_applications set status = 'PAID' where id = '${correctionApplicationId}'`);
    const staff = { staffUserId: randomUUID(), role: 'manager' as const };
    await adminVisa.requestCorrection(correctionApplicationId, { requestType: 'ADDITIONAL_INFO', reason: 'Please clarify your given name.',
      travellerId: aliceTraveller, fieldKey: 'first_name' }, staff, 'test-request');
    const requested = await request(app.getHttpServer()).get(`/api/v1/visa-applications/${correctionApplicationId}`).set(bearer('alice')).expect(200);
    expect(requested.body.data.status).toBe('ADDITIONAL_INFORMATION_REQUIRED');
    expect(requested.body.data.reviewRequests[0].status).toBe('OPEN');
    const updated = await request(app.getHttpServer()).patch(`/api/v1/visa-applications/${correctionApplicationId}/answers`).set(bearer('alice'))
      .send({ scope: aliceTraveller, answers: { first_name: 'Ain Updated' } }).expect(200);
    expect(updated.body.data.status).toBe('DOCUMENT_REVIEW');
    expect(updated.body.data.reviewRequests[0].status).toBe('RESOLVED');
    expect(updated.body.data.answers[aliceTraveller].first_name).toBe('Ain Updated');
    const requirementId = created.body.data.requirements[0].id as string;
    await adminVisa.requestCorrection(correctionApplicationId, { requestType: 'DOCUMENT', reason: 'Please replace the passport copy.', requirementId }, staff, 'test-document-request');
    await adminVisa.requestCorrection(correctionApplicationId, { requestType: 'ANSWER', reason: 'Please verify your name.',
      travellerId: aliceTraveller, fieldKey: 'first_name' }, staff, 'test-answer-request');
    const mixedRequests = await request(app.getHttpServer()).get(`/api/v1/visa-applications/${correctionApplicationId}`).set(bearer('alice')).expect(200);
    expect(mixedRequests.body.data.status).toBe('ADDITIONAL_DOCUMENTS_REQUIRED');
    const savedDuringMixedRequest = await request(app.getHttpServer()).patch(`/api/v1/visa-applications/${correctionApplicationId}/answers`).set(bearer('alice'))
      .send({ scope: aliceTraveller, answers: { first_name: 'Ain Final' } }).expect(200);
    expect(savedDuringMixedRequest.body.data.status).toBe('ADDITIONAL_DOCUMENTS_REQUIRED');
    expect(savedDuringMixedRequest.body.data.reviewRequests.some((item: { requestType: string; status: string }) => item.requestType === 'DOCUMENT' && item.status === 'OPEN')).toBe(true);
  });

  it('rejects cross-account and cross-traveller document links and preserves the submitted version', async () => {
    const detail = await request(app.getHttpServer()).get(`/api/v1/visa-applications/${applicationId}`).set(bearer('alice')).expect(200);
    const ainRequirement = detail.body.data.requirements.find((item: { travellerId: string }) => item.travellerId === aliceTraveller);
    const fatimahRequirement = detail.body.data.requirements.find((item: { travellerId: string }) => item.travellerId === secondTraveller);
    const ownVersionId = detail.body.data.requirements ? (await request(app.getHttpServer()).get(`/api/v1/documents/${documentId}`).set(bearer('alice')).expect(200)).body.data.currentVersion.id as string : '';
    await request(app.getHttpServer()).post(`/api/v1/visa-applications/${applicationId}/requirements/${ainRequirement.id}/documents`).set(bearer('alice')).send({ documentId: bobDocumentId, documentVersionId: randomUUID() }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/visa-applications/${applicationId}/requirements/${fatimahRequirement.id}/documents`).set(bearer('alice')).send({ documentId, documentVersionId: ownVersionId }).expect(400);
    const linked = await request(app.getHttpServer()).post(`/api/v1/visa-applications/${applicationId}/requirements/${ainRequirement.id}/documents`).set(bearer('alice')).send({ documentId, documentVersionId: firstVersionId }).expect(201);
    expect(linked.body.data.requirements.find((item: { id: string }) => item.id === ainRequirement.id).documents[0].documentVersionId).toBe(firstVersionId);
    await request(app.getHttpServer()).post(`/api/v1/visa-applications/${applicationId}/requirements/${ainRequirement.id}/documents`).set(bearer('alice')).send({ documentId, documentVersionId: firstVersionId }).expect(409);
    await request(app.getHttpServer()).patch(`/api/v1/visa-applications/${applicationId}`).set(bearer('alice')).send({ action: 'SUBMIT_DOCUMENTS' }).expect(400);
  });

  it('blocks visa IDOR, invalid transitions, and archives without erasing history', async () => {
    await request(app.getHttpServer()).get(`/api/v1/visa-applications/${applicationId}`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).patch(`/api/v1/visa-applications/${applicationId}`).set(bearer('bob')).send({ action: 'MARK_INCOMPLETE' }).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/visa-applications/${applicationId}/requirements/${randomUUID()}/documents`).set(bearer('bob')).send({ documentId: bobDocumentId, documentVersionId: randomUUID() }).expect(404);
    await request(app.getHttpServer()).delete(`/api/v1/visa-applications/${applicationId}`).set(bearer('bob')).expect(404);
    await request(app.getHttpServer()).patch(`/api/v1/visa-applications/${applicationId}`).set(bearer('alice')).send({ action: 'MARK_INCOMPLETE' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/visa-applications/${applicationId}`).set(bearer('alice')).send({ action: 'MARK_INCOMPLETE' }).expect(409);
    expect(database.public.many(`select id from visa_status_history where application_id = '${applicationId}'`)).toHaveLength(2);
    await request(app.getHttpServer()).delete(`/api/v1/visa-applications/${applicationId}`).set(bearer('alice')).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/visa-applications/${applicationId}`).set(bearer('alice')).expect(404);
    expect(database.public.many(`select id from visa_applications where id = '${applicationId}'`)).toHaveLength(1);
    await request(app.getHttpServer()).delete(`/api/v1/documents/${documentId}`).set(bearer('alice')).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/documents/${documentId}`).set(bearer('alice')).expect(404);
    expect(database.public.many(`select id from document_versions where document_id = '${documentId}'`)).toHaveLength(3);
  });
});
