import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@flyseri/database';
import type { DatabaseConnection } from '@flyseri/database';
import { DrizzleTripStore } from './trip.repository.js';
import { DrizzleVisaStore } from '../visa/visa.repository.js';

describe('trip PostgreSQL migrations', () => {
  it('applies the full migration chain with ownership, date, uniqueness and RLS constraints', async () => {
    const database = new PGlite();
    try {
      for (const filename of [
        '0000_mean_ultimates.sql', '0001_nasty_thor.sql', '0002_customer_rls.sql',
        '0003_famous_stranger.sql', '0004_trip_rls.sql', '0005_mighty_blob.sql', '0006_visa_document_rls.sql', '0007_kind_lady_bullseye.sql', '0008_remarkable_silver_fox.sql', '0009_glamorous_mandarin.sql',
        '0010_mushy_doctor_spectrum.sql', '0011_overrated_firedrake.sql', '0012_dazzling_ultimatum.sql',
        '0013_cheerful_jasper_sitwell.sql', '0014_foamy_hemingway.sql', '0015_outgoing_big_bertha.sql',
        '0016_strong_shinobi_shaw.sql', '0017_overconfident_wildside.sql', '0018_busy_arachne.sql',
        '0019_cuddly_ted_forrester.sql', '0020_visa_history_status_length.sql',
      ]) {
        const migration = readFileSync(resolve(process.cwd(), '../../packages/database/drizzle', filename), 'utf8');
        for (const statement of migration.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
          await database.exec(statement);
        }
      }

      const rls = await database.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relname in ('trips', 'trip_destinations', 'trip_travellers') order by relname",
      );
      expect(rls.rows).toEqual([
        { relname: 'trip_destinations', relrowsecurity: true },
        { relname: 'trip_travellers', relrowsecurity: true },
        { relname: 'trips', relrowsecurity: true },
      ]);
      const sensitive = await database.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relname in ('documents', 'document_versions', 'visa_types', 'visa_requirements', 'visa_applications', 'visa_application_travellers', 'visa_application_requirements', 'visa_requirement_documents', 'visa_status_history', 'visa_service_versions', 'visa_review_requests', 'visa_application_notes')",
      );
      expect(sensitive.rows).toHaveLength(12);
      expect(sensitive.rows.every((row) => row.relrowsecurity)).toBe(true);
      const historyWidths = await database.query<{ column_name: string; character_maximum_length: number }>(
        "select column_name, character_maximum_length from information_schema.columns where table_name = 'visa_status_history' and column_name in ('from_status', 'to_status') order by column_name",
      );
      expect(historyWidths.rows).toEqual([
        { column_name: 'from_status', character_maximum_length: 40 },
        { column_name: 'to_status', character_maximum_length: 40 },
      ]);
      const adminAudit = await database.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'admin_audit_events'");
      expect(adminAudit.rows).toEqual([{ relrowsecurity: true }]);

      const customerId = randomUUID();
      const travellerId = randomUUID();
      const tripId = randomUUID();
      await database.query('insert into customers (id, auth_user_id) values ($1, $2)', [customerId, randomUUID()]);
      await database.query('insert into travellers (id, legal_first_name, legal_last_name) values ($1, $2, $3)', [travellerId, 'Ain', 'Rahman']);
      await database.query('insert into trips (id, customer_id) values ($1, $2)', [tripId, customerId]);
      await database.query('insert into trip_destinations (trip_id, country_code, sequence) values ($1, $2, $3)', [tripId, 'JP', 1]);
      await database.query('insert into trip_travellers (trip_id, traveller_id) values ($1, $2)', [tripId, travellerId]);

      await expect(database.query('insert into trip_travellers (trip_id, traveller_id) values ($1, $2)', [tripId, travellerId])).rejects.toThrow();
      await expect(database.query('insert into trip_destinations (trip_id, country_code, sequence) values ($1, $2, $3)', [tripId, 'JP', 1])).rejects.toThrow();
      await expect(database.query('insert into trips (customer_id, start_date, end_date) values ($1, $2, $3)', [customerId, '2026-12-20', '2026-12-01'])).rejects.toThrow();
      await expect(database.query('insert into trips (customer_id) values ($1)', [randomUUID()])).rejects.toThrow();

      const connection = { db: drizzle(database, { schema }) } as unknown as DatabaseConnection;
      const store = new DrizzleTripStore(connection);
      const before = await database.query<{ count: string }>('select count(*)::text as count from trips');
      await expect(store.create(customerId, {
        destinations: [{ countryCode: 'JP', startDate: '2026-12-20', endDate: '2026-12-01' }],
        travellerIds: [travellerId],
      })).rejects.toThrow();
      const after = await database.query<{ count: string }>('select count(*)::text as count from trips');
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);

      const visaTypeId = randomUUID();
      await database.query("insert into customer_travellers (customer_id, traveller_id, relationship_type) values ($1, $2, 'SELF')", [customerId, travellerId]);
      await database.query("insert into visa_types (id, destination_country_code, code, name, active) values ($1, 'JP', 'TEST', 'Test visa', true)", [visaTypeId]);
      await database.query("insert into visa_service_versions (visa_type_id, version, active, form_definition) values ($1, 1, true, '{\"sections\":[]}')", [visaTypeId]);
      await database.query("insert into visa_requirements (visa_type_id, requirement_code, name, active) values ($1, 'PASSPORT', 'Passport', true)", [visaTypeId]);
      await database.exec("alter table visa_application_requirements add constraint test_snapshot_failure check (status <> 'MISSING')");
      const visaStore = new DrizzleVisaStore(connection);
      await expect(visaStore.create(customerId, tripId, visaTypeId, [travellerId])).rejects.toThrow();
      const applications = await database.query<{ count: string }>('select count(*)::text as count from visa_applications');
      const applicants = await database.query<{ count: string }>('select count(*)::text as count from visa_application_travellers');
      expect(applications.rows[0]?.count).toBe('0');
      expect(applicants.rows[0]?.count).toBe('0');
    } finally {
      await database.close();
    }
  }, 20_000);
});
