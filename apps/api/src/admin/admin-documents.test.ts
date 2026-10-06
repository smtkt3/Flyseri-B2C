import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { parseConfig } from '@flyseri/config';
import { AdminDocumentsService } from './admin-documents.service.js';
import { AdminRecordsService } from './admin-records.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

describe('staff document version access', () => {
  it('issues a short-lived URL only for the matched uploaded version and audits without a storage path or URL', async () => {
    const database = new PGlite();
  await database.exec('CREATE ROLE flyseri_api');
    try {
      const directory = resolve(process.cwd(), '../../packages/database/drizzle');
      const journal = JSON.parse(readFileSync(resolve(directory, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        const migration = readFileSync(resolve(directory, `${entry.tag}.sql`), 'utf8');
        for (const statement of migration.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) await database.exec(statement);
      }
      const customerId = randomUUID(), documentId = randomUUID(), versionId = randomUUID(), otherVersionId = randomUUID();
      const staffUserId = randomUUID(), otherDocumentId = randomUUID();
      await database.query('insert into customers (id, auth_user_id) values ($1, $2)', [customerId, randomUUID()]);
      await database.query("insert into documents (id, customer_id, document_type) values ($1, $2, 'PASSPORT'), ($3, $2, 'PASSPORT')", [documentId, customerId, otherDocumentId]);
      await database.query("insert into document_versions (id, document_id, storage_path, original_filename, mime_type, file_size, checksum_sha256, version_number, idempotency_key, upload_state) values ($1, $2, 'private/one', 'passport.pdf', 'application/pdf', 42, $3, 1, $4, 'UPLOADED'), ($5, $6, 'private/two', 'other.pdf', 'application/pdf', 42, $3, 1, $7, 'UPLOADED')",
        [versionId, documentId, 'a'.repeat(64), randomUUID(), otherVersionId, otherDocumentId, randomUUID()]);
      const signedUrl = vi.fn(async () => 'https://storage.example.invalid/signed?token=private');
      const storage = { signedUrl, upload: vi.fn(), remove: vi.fn() };
      const connection = { db: drizzle(database, { schema }) } as unknown as DatabaseConnection;
      const service = new AdminDocumentsService(connection, storage, parseConfig({ APP_ENV: 'test' }));
      const detail = await service.detail(documentId);
      expect(JSON.stringify(detail)).not.toContain('private/one');
      expect(JSON.stringify(detail)).not.toContain('passport.pdf');
      await expect(service.access(documentId, otherVersionId, { staffUserId, role: 'owner' }, 'request-1', true)).rejects.toThrow();
      expect(signedUrl).not.toHaveBeenCalled();
      const access = await service.access(documentId, versionId, { staffUserId, role: 'owner' }, 'request-2', true);
      expect(access).toEqual({ url: 'https://storage.example.invalid/signed?token=private', expiresInSeconds: 60 });
      expect(signedUrl).toHaveBeenCalledWith('private/one', 60, true);
      const audit = await database.query<{ staff_user_id: string; event: string; resource_id: string; request_id: string }>('select staff_user_id, event, resource_id, request_id from admin_audit_events');
      expect(audit.rows).toEqual([{ staff_user_id: staffUserId, event: 'document.download_url_issued', resource_id: versionId, request_id: 'request-2' }]);
      expect(JSON.stringify(audit.rows)).not.toContain('private/one');
      const travellerId = randomUUID(), tripId = randomUUID(), visaTypeId = randomUUID(), applicationId = randomUUID();
      await database.query("insert into travellers (id, legal_first_name, legal_last_name) values ($1, 'Ain', 'Rahman')", [travellerId]);
      await database.query("insert into customer_travellers (customer_id, traveller_id, relationship_type) values ($1, $2, 'SELF')", [customerId, travellerId]);
      await database.query("insert into trips (id, customer_id, title, status) values ($1, $2, 'Japan', 'ACTIVE')", [tripId, customerId]);
      await database.query("insert into trip_destinations (trip_id, country_code, city_name, sequence) values ($1, 'JP', 'Tokyo', 1)", [tripId]);
      await database.query('insert into trip_travellers (trip_id, traveller_id) values ($1, $2)', [tripId, travellerId]);
      await database.query("insert into visa_types (id, destination_country_code, code, name) values ($1, 'JP', 'TEST', 'Test visa')", [visaTypeId]);
      await database.query("insert into visa_applications (id, customer_id, trip_id, visa_type_id, destination_country_code, status) values ($1, $2, $3, $4, 'JP', 'DOCUMENTS_SUBMITTED')", [applicationId, customerId, tripId, visaTypeId]);
      await database.query("update documents set status = 'REVIEW_REQUIRED' where id = $1", [documentId]);
      await database.query("insert into audit_events (actor_customer_id, event) values ($1, 'trip.created')", [customerId]);
      const records = new AdminRecordsService(connection);
      const query = { page: 1, limit: 20 };
      expect((await records.customers(query)).total).toBe(1);
      expect((await records.travellers(query)).items[0]).toMatchObject({ id: travellerId, customerId });
      expect((await records.trips(query)).items[0]).toMatchObject({ id: tripId, destinationCity: 'Tokyo', travellerCount: 1 });
      expect((await records.visas(query)).items[0]).toMatchObject({ id: applicationId, status: 'DOCUMENTS_SUBMITTED' });
      expect((await records.visas({ ...query, tripId })).total).toBe(1);
      expect((await records.visas({ ...query, tripId: randomUUID() })).total).toBe(0);
      expect((await records.trips({ ...query, customerId: randomUUID() })).total).toBe(0);
      expect((await service.list(query)).total).toBe(2);
      expect((await service.list({ ...query, customerId: randomUUID() })).total).toBe(0);
      expect((await records.audit(query)).total).toBe(1);
      const summary = await new AdminDashboardService(connection).summary();
      expect(summary.metrics).toMatchObject({ customers: 1, activeTrips: 1, visaApplicationsSubmitted: 1, documentsRequiringReview: 1,
        visa: { awaitingPayment: 0, paid: 0, documentReview: 0, actionRequired: 0,
          submittedForProcessing: 0, approvedOrIssued: 0, rejected: 0, completed: 0 } });
    } finally { await database.close(); }
  }, 20_000);
});
