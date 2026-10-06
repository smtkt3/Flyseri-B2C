import { describe, expect, it } from 'vitest';
import { checkoutPassengerError } from './checkoutContinuation';

const adult = { kind: 'Adult', givenNames: 'Test', surname: 'Traveler', gender: 'MALE', birthDate: '1990-01-01', nationality: 'MY' };
describe('traveler age checks before checkout', () => {
  it('allows complete adult details without collecting unused ID numbers', () => {
    expect(checkoutPassengerError(adult, '2026-11-18', '2026-11-30')).toBeNull();
  });
  it('rejects invalid dates and passenger categories before saving a profile', () => {
    expect(checkoutPassengerError({ ...adult, birthDate: '1990-02-31' }, '2026-11-18', '2026-11-30')).toContain('valid date');
    expect(checkoutPassengerError({ ...adult, birthDate: '2020-01-01' }, '2026-11-18', '2026-11-30')).toContain('selected adult');
  });
  it('handles birthdays during travel, including lap infants', () => {
    expect(checkoutPassengerError({ ...adult, kind: 'Child', birthDate: '2014-11-20' }, '2026-11-18', '2026-11-30')).toContain('changes age category');
    expect(checkoutPassengerError({ ...adult, kind: 'Infant', birthDate: '2024-11-20' }, '2026-11-18', '2026-11-30')).toContain('changes age category');
    expect(checkoutPassengerError({ ...adult, kind: 'Child', birthDate: '2014-11-18' }, '2026-11-18', '2026-11-30')).toContain('selected child');
  });
});
