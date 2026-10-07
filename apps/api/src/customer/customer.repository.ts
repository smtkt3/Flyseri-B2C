import { eq, and, isNull } from 'drizzle-orm';
import { auditEvents, customers, customerTravellers, travellers, type DatabaseConnection } from '@flyseri/database';
import type { CustomerProfile, TravellerProfile, TravellerRelationship, TravellerGender } from '@flyseri/types';

export interface TravellerInput {
  saveForFuture?: boolean;
  legalFirstName: string;
  legalMiddleName?: string | null;
  legalLastName: string;
  dateOfBirth?: string | null;
  gender?: TravellerGender | null;
  nationalityCountryCode?: string | null;
  relationshipType: TravellerRelationship;
}

export type TravellerPatch = Partial<TravellerInput>;
export class TravellerConflictError extends Error {}

export interface CustomerStore {
  bootstrap(authUserId: string): Promise<{ id: string; status: string; profile: CustomerProfile }>;
  updateProfile(customerId: string, patch: Partial<CustomerProfile>): Promise<CustomerProfile>;
  listTravellers(customerId: string): Promise<TravellerProfile[]>;
  getTraveller(customerId: string, travellerId: string): Promise<TravellerProfile | null>;
  createTraveller(customerId: string, input: TravellerInput): Promise<TravellerProfile>;
  updateTraveller(customerId: string, travellerId: string, patch: TravellerPatch): Promise<TravellerProfile | null>;
  archiveTraveller(customerId: string, travellerId: string): Promise<boolean>;
}

const safeCustomer = (row: typeof customers.$inferSelect): CustomerProfile => ({
  displayName: row.displayName,
  phoneCountryCode: row.phoneCountryCode,
  phoneNumber: row.phoneNumber,
  preferredLanguage: row.preferredLanguage,
  preferredCurrency: row.preferredCurrency,
});

type TravellerRow = typeof travellers.$inferSelect;
type LinkRow = typeof customerTravellers.$inferSelect;
const safeTraveller = (row: TravellerRow, link: LinkRow): TravellerProfile => ({
  id: row.id,
  legalFirstName: row.legalFirstName,
  legalMiddleName: row.legalMiddleName,
  legalLastName: row.legalLastName,
  dateOfBirth: dateOnly(row.dateOfBirth),
  gender: row.gender as TravellerGender | null,
  nationalityCountryCode: row.nationalityCountryCode,
  relationshipType: link.relationshipType as TravellerRelationship,
  isPrimary: link.isPrimary,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const dateOnly = (value: unknown): string | null => value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' ? value : null;

export class DrizzleCustomerStore implements CustomerStore {
  constructor(private readonly connection: DatabaseConnection) {}

  async bootstrap(authUserId: string) {
    const db = this.connection.db;
    const [created] = await db.insert(customers).values({ authUserId }).onConflictDoNothing({ target: customers.authUserId }).returning();
    const row = created ?? (await db.select().from(customers).where(eq(customers.authUserId, authUserId)).limit(1))[0];
    if (!row) throw new Error('Customer bootstrap failed');
    return { id: row.id, status: row.status, profile: safeCustomer(row) };
  }

  async updateProfile(customerId: string, patch: Partial<CustomerProfile>): Promise<CustomerProfile> {
    return this.connection.db.transaction(async (tx) => {
      const [row] = await tx.update(customers).set({ ...patch, updatedAt: new Date() }).where(eq(customers.id, customerId)).returning();
      if (!row) throw new Error('Customer profile missing');
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, event: 'customer.profile.updated' });
      return safeCustomer(row);
    });
  }

  async listTravellers(customerId: string): Promise<TravellerProfile[]> {
    const rows = await this.connection.db.select({ traveller: travellers, link: customerTravellers })
      .from(customerTravellers).innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
      .where(and(eq(customerTravellers.customerId, customerId), isNull(travellers.archivedAt)));
    const bookingOnly = await this.connection.db.select({ travellerId: auditEvents.travellerId }).from(auditEvents)
      .where(and(eq(auditEvents.actorCustomerId, customerId), eq(auditEvents.event, 'traveller.booking_only')));
    const hiddenIds = new Set(bookingOnly.map(({ travellerId }) => travellerId));
    return rows.filter(({ traveller }) => !hiddenIds.has(traveller.id)).map(({ traveller, link }) => safeTraveller(traveller, link));
  }

  async getTraveller(customerId: string, travellerId: string): Promise<TravellerProfile | null> {
    const [row] = await this.connection.db.select({ traveller: travellers, link: customerTravellers })
      .from(customerTravellers).innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
      .where(and(eq(customerTravellers.customerId, customerId), eq(travellers.id, travellerId), isNull(travellers.archivedAt))).limit(1);
    return row ? safeTraveller(row.traveller, row.link) : null;
  }

  async createTraveller(customerId: string, input: TravellerInput): Promise<TravellerProfile> {
    return this.connection.db.transaction(async (tx) => {
      const { relationshipType, saveForFuture = true, ...data } = input;
      if (relationshipType === 'SELF') {
        const [existing] = await tx.select({ id: customerTravellers.id }).from(customerTravellers)
          .where(and(eq(customerTravellers.customerId, customerId), eq(customerTravellers.isPrimary, true))).limit(1);
        if (existing) throw new TravellerConflictError('A primary traveller already exists');
      }
      const [traveller] = await tx.insert(travellers).values(data).returning();
      if (!traveller) throw new Error('Traveller creation failed');
      const [link] = await tx.insert(customerTravellers).values({ customerId, travellerId: traveller.id, relationshipType, isPrimary: relationshipType === 'SELF' }).returning();
      if (!link) throw new Error('Traveller relationship creation failed');
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, travellerId: traveller.id, event: 'traveller.created' });
      if (!saveForFuture) await tx.insert(auditEvents).values({actorCustomerId:customerId,travellerId:traveller.id,event:'traveller.booking_only'});
      else await tx.insert(auditEvents).values({actorCustomerId:customerId,travellerId:traveller.id,event:'traveller.save_consented'});
      return {...safeTraveller(traveller, link),saveForFuture};
    });
  }

  async updateTraveller(customerId: string, travellerId: string, patch: TravellerPatch): Promise<TravellerProfile | null> {
    return this.connection.db.transaction(async (tx) => {
      const [owned] = await tx.select({ traveller: travellers, link: customerTravellers })
        .from(customerTravellers).innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
        .where(and(eq(customerTravellers.customerId, customerId), eq(travellers.id, travellerId), isNull(travellers.archivedAt))).limit(1);
      if (!owned) return null;
      const { relationshipType, saveForFuture: _saveChoice, ...data } = patch;
      const [traveller] = await tx.update(travellers).set({ ...data, updatedAt: new Date() }).where(eq(travellers.id, travellerId)).returning();
      let link = owned.link;
      if (relationshipType) {
        const [updatedLink] = await tx.update(customerTravellers).set({ relationshipType, isPrimary: relationshipType === 'SELF' })
          .where(eq(customerTravellers.id, owned.link.id)).returning();
        if (!updatedLink) throw new Error('Traveller relationship missing');
        link = updatedLink;
      }
      if (!traveller) throw new Error('Traveller missing');
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, travellerId, event: 'traveller.updated' });
      return safeTraveller(traveller, link);
    });
  }

  async archiveTraveller(customerId: string, travellerId: string): Promise<boolean> {
    return this.connection.db.transaction(async (tx) => {
      const [owned] = await tx.select({ id: travellers.id, linkId: customerTravellers.id }).from(customerTravellers)
        .innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
        .where(and(eq(customerTravellers.customerId, customerId), eq(travellers.id, travellerId), isNull(travellers.archivedAt))).limit(1);
      if (!owned) return false;
      await tx.update(travellers).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(travellers.id, travellerId));
      await tx.update(customerTravellers).set({ isPrimary: false }).where(eq(customerTravellers.id, owned.linkId));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, travellerId, event: 'traveller.archived' });
      return true;
    });
  }
}
