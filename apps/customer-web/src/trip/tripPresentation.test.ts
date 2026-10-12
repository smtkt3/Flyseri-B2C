import { expect, it } from 'vitest';
import { countryName } from './tripPresentation';

it('renders valid country names and safely handles incomplete API data', () => {
  expect(countryName('BD')).toBe('Bangladesh');
  expect(countryName(' my ')).toBe('Malaysia');
  expect(countryName('')).toBe('');
  expect(countryName(undefined)).toBe('');
  expect(countryName(null)).toBe('');
  expect(countryName('invalid')).toBe('INVALID');
  expect(countryName('B1')).toBe('B1');
});
