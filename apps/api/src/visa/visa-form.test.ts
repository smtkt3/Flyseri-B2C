import { describe, expect, it } from 'vitest';
import { VisaValidationError } from './visa.errors.js';
import { conditionMatches, parseVisaFormDefinition, validateVisaAnswers } from './visa-form.js';

const form = () => parseVisaFormDefinition({ sections: [
  { key: 'travel', label: 'Travel', displayOrder: 2, fields: [
    { key: 'sponsored', label: 'Is this trip sponsored?', type: 'YES_NO', required: true, applicantScope: 'APPLICATION' },
    { key: 'sponsor_name', label: 'Sponsor name', type: 'TEXT', required: true,
      visibleWhen: [{ field: 'sponsored', operator: 'EQ', value: 'true' }] },
    { key: 'travel_purpose', label: 'Purpose', type: 'SELECT', required: true,
      options: [{ label: 'Tourism', value: 'TOURISM' }, { label: 'Study', value: 'STUDY' }] },
  ] },
  { key: 'personal', label: 'Personal', displayOrder: 1, fields: [
    { key: 'nationality', label: 'Nationality', type: 'COUNTRY', required: true, applicantScope: 'APPLICANT' },
    { key: 'previous_visas', label: 'Previous visas', type: 'MULTI_SELECT', required: false,
      options: [{ label: 'Japan', value: 'JP' }, { label: 'Korea', value: 'KR' }] },
    { key: 'arrival_date', label: 'Arrival date', type: 'DATE', required: false },
  ] },
] });

describe('configurable visa form validation', () => {
  it('orders sections and enforces application-wide conditions for each applicant', () => {
    const definition = form();
    expect(definition.sections.map((section) => section.key)).toEqual(['personal', 'travel']);
    const applicants = ['a', 'b'];
    expect(validateVisaAnswers(definition, { application: { sponsored: true }, a: { nationality: 'MY', sponsor_name: 'Amir', travel_purpose: 'TOURISM' },
      b: { nationality: 'BD', sponsor_name: 'Mina', travel_purpose: 'STUDY' } }, applicants, true)).toEqual([]);
    expect(validateVisaAnswers(definition, { application: { sponsored: true }, a: { nationality: 'MY', travel_purpose: 'TOURISM' },
      b: { nationality: 'BD', sponsor_name: 'Mina', travel_purpose: 'STUDY' } }, applicants, true))
      .toContain('Travel: Sponsor name');
  });

  it('checks real calendar dates, country codes, option membership, and applicant scope', () => {
    const definition = form();
    for (const invalid of [
      { application: { sponsored: false }, a: { nationality: 'Malaysia', travel_purpose: 'TOURISM' } },
      { application: { sponsored: false }, a: { nationality: 'MY', travel_purpose: 'UNKNOWN' } },
      { application: { sponsored: false }, a: { nationality: 'MY', travel_purpose: 'TOURISM', arrival_date: '2026-02-30' } },
      { application: { sponsored: false, nationality: 'MY' }, a: { nationality: 'MY', travel_purpose: 'TOURISM' } },
      { application: { sponsored: false }, a: { nationality: 'MY', travel_purpose: 'TOURISM', previous_visas: ['XX'] } },
    ]) expect(() => validateVisaAnswers(definition, invalid, ['a'], false)).toThrow(VisaValidationError);
  });

  it('rejects unknown applicants, duplicate keys, and conditional references that cannot be validated', () => {
    expect(() => validateVisaAnswers(form(), { ghost: { nationality: 'MY' } }, ['a'], false)).toThrow('not on this application');
    expect(() => parseVisaFormDefinition({ sections: [
      { key: 'one', label: 'One', fields: [{ key: 'answer', label: 'Answer', type: 'TEXT', required: true }] },
      { key: 'two', label: 'Two', fields: [{ key: 'answer', label: 'Duplicate', type: 'TEXT', required: false }] },
    ] })).toThrow('invalid field');
    expect(() => parseVisaFormDefinition({ sections: [{ key: 'one', label: 'One', fields: [
      { key: 'conditional', label: 'Conditional', type: 'TEXT', required: true, visibleWhen: [{ field: 'missing', operator: 'EQ', value: 'yes' }] },
    ] }] })).toThrow('same or shared application scope');
  });

  it('treats missing condition source answers as hidden and evaluates multiselect membership safely', () => {
    expect(conditionMatches([{ field: 'employed', operator: 'EQ', value: 'yes' }], {})).toBe(false);
    expect(conditionMatches([{ field: 'visas', operator: 'IN', value: ['JP', 'KR'] }], { visas: ['SG', 'KR'] })).toBe(true);
    expect(conditionMatches([{ field: 'visas', operator: 'NEQ', value: 'JP' }], { visas: ['JP', 'KR'] })).toBe(false);
  });
});
