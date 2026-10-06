import type { VisaFieldCondition, VisaFieldType, VisaFormDefinition, VisaFormField } from '@flyseri/types';
import { VisaValidationError } from './visa.errors.js';

const fieldTypes = new Set<VisaFieldType>(['TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'NUMBER', 'DATE', 'YEAR', 'SELECT', 'MULTI_SELECT', 'RADIO', 'CHECKBOX', 'COUNTRY', 'ADDRESS', 'PASSPORT', 'YES_NO']);
const keyPattern = /^[a-z][a-z0-9_.-]{0,79}$/;
const conditions = (input: unknown): VisaFieldCondition[] => {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 10) throw new VisaValidationError('The visa form has invalid conditional rules');
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new VisaValidationError('The visa form has invalid conditional rules');
    const value = raw as Record<string, unknown>;
    if (typeof value.field !== 'string' || !keyPattern.test(value.field) || !['EQ', 'NEQ', 'IN'].includes(String(value.operator)) ||
        !(typeof value.value === 'string' || Array.isArray(value.value) && value.value.length <= 20 && value.value.every((item) => typeof item === 'string'))) {
      throw new VisaValidationError('The visa form has invalid conditional rules');
    }
    return { field: value.field, operator: value.operator as VisaFieldCondition['operator'], value: value.value as string | string[] };
  });
};

export function parseVisaFormDefinition(input: unknown): VisaFormDefinition {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { sections?: unknown }).sections)) {
    throw new VisaValidationError('A valid visa form definition is required');
  }
  const rawSections = (input as { sections: unknown[] }).sections;
  if (rawSections.length > 30) throw new VisaValidationError('The visa form has too many sections');
  const keys = new Set<string>();
  const sections = rawSections.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new VisaValidationError('The visa form contains an invalid section');
    const section = raw as Record<string, unknown>;
    if (typeof section.key !== 'string' || !keyPattern.test(section.key) || keys.has(section.key) ||
        typeof section.label !== 'string' || !section.label.trim() || section.label.length > 100 || !Array.isArray(section.fields)) {
      throw new VisaValidationError('The visa form contains an invalid section');
    }
    keys.add(section.key);
    return { key: section.key, label: section.label.trim(), displayOrder: Number.isInteger(section.displayOrder) ? Number(section.displayOrder) : index,
      fields: section.fields.map((entry): VisaFormField => {
        if (!entry || typeof entry !== 'object') throw new VisaValidationError('The visa form contains an invalid field');
        const field = entry as Record<string, unknown>;
        if (typeof field.key !== 'string' || !keyPattern.test(field.key) || keys.has(field.key) ||
            typeof field.label !== 'string' || !field.label.trim() || field.label.length > 160 ||
            !fieldTypes.has(field.type as VisaFieldType) || typeof field.required !== 'boolean') {
          throw new VisaValidationError('The visa form contains an invalid field');
        }
        keys.add(field.key);
        const options = field.options === undefined ? undefined : field.options;
        if (options !== undefined && (!Array.isArray(options) || options.length > 100 || options.some((option) => !option || typeof option !== 'object' ||
            typeof (option as Record<string, unknown>).label !== 'string' || typeof (option as Record<string, unknown>).value !== 'string'))) {
          throw new VisaValidationError(`Invalid options for ${field.label}`);
        }
        const type = field.type as VisaFieldType;
        if (['SELECT', 'MULTI_SELECT', 'RADIO'].includes(type) && (!Array.isArray(options) || !options.length)) {
          throw new VisaValidationError(`Add options for ${field.label}`);
        }
        const validation = field.validation;
        if (validation !== undefined && (!validation || typeof validation !== 'object' || Array.isArray(validation))) throw new VisaValidationError(`Invalid validation for ${field.label}`);
        return { key: field.key, label: field.label.trim(), type, required: field.required,
          helpText: typeof field.helpText === 'string' ? field.helpText.slice(0, 500) : null,
          placeholder: typeof field.placeholder === 'string' ? field.placeholder.slice(0, 160) : null,
          options: options as VisaFormField['options'], validation: validation as VisaFormField['validation'],
          visibleWhen: conditions(field.visibleWhen), applicantScope: field.applicantScope === 'APPLICATION' ? 'APPLICATION' : 'APPLICANT' };
      }) };
  });
  const fields = sections.flatMap((section) => section.fields);
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  for (const field of fields) for (const rule of field.visibleWhen ?? []) {
    const source = fieldByKey.get(rule.field);
    if (!source || !source.required || field.applicantScope === 'APPLICATION' && source.applicantScope !== 'APPLICATION') {
      throw new VisaValidationError(`Conditional field ${field.label} must refer to a required question in the same or shared application scope`);
    }
  }
  return { sections: sections.sort((a, b) => a.displayOrder - b.displayOrder) };
}

export function conditionMatches(rules: VisaFieldCondition[] | null | undefined, answers: Record<string, unknown>): boolean {
  for (const rule of rules ?? []) {
    const actual = answers[rule.field];
    if (actual === undefined || actual === null || actual === '') return false;
    const values = Array.isArray(rule.value) ? rule.value : [rule.value];
    const matches = Array.isArray(actual) ? actual.some((item) => values.includes(String(item))) : values.includes(String(actual));
    if (rule.operator === 'EQ' && !matches) return false;
    if (rule.operator === 'NEQ' && matches) return false;
    if (rule.operator === 'IN' && !matches) return false;
  }
  return true;
}

function validValue(field: VisaFormField, value: unknown): boolean {
  if (field.type === 'CHECKBOX' || field.type === 'YES_NO') return typeof value === 'boolean';
  if (field.type === 'MULTI_SELECT') return Array.isArray(value) && value.every((item) => typeof item === 'string' && field.options?.some((option) => option.value === item));
  if (field.type === 'ADDRESS') return typeof value === 'string' && value.length <= 2000;
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  const validation = field.validation ?? {};
  if (normalized.length > (validation.maxLength ?? 4000) || normalized.length < (validation.minLength ?? 0)) return false;
  if (field.type === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) return false;
  if (field.type === 'PHONE' && !/^\+?[0-9 ()-]{5,24}$/.test(normalized)) return false;
  if (field.type === 'NUMBER' && (!/^-?\d+(?:\.\d+)?$/.test(normalized) || validation.min !== undefined && Number(normalized) < validation.min || validation.max !== undefined && Number(normalized) > validation.max)) return false;
  if (field.type === 'DATE') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) return false;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return false;
  }
  if (field.type === 'YEAR' && !/^\d{4}$/.test(normalized)) return false;
  if (field.type === 'PASSPORT' && !/^[A-Za-z0-9-]{3,24}$/.test(normalized)) return false;
  if (['SELECT', 'RADIO', 'COUNTRY'].includes(field.type)) {
    if (field.options?.length && !field.options.some((option) => option.value === normalized)) return false;
    if (field.type === 'COUNTRY' && !field.options?.length && !/^[A-Z]{2}$/.test(normalized)) return false;
  }
  if (field.validation?.pattern) {
    const source = field.validation.pattern;
    if (source.length > 160 || /\([^)]*[+*][^)]*\)[+*{]/.test(source)) return false;
    try { if (!new RegExp(source).test(normalized)) return false; } catch { return false; }
  }
  return true;
}

export function validateVisaAnswers(form: VisaFormDefinition, input: unknown, applicantIds: string[], requireRequired: boolean): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new VisaValidationError('Application answers must be an object');
  const answers = input as Record<string, Record<string, unknown>>;
  const scopes = new Set(['application', ...applicantIds]);
  if (Object.keys(answers).some((scope) => !scopes.has(scope) || !answers[scope] || typeof answers[scope] !== 'object' || Array.isArray(answers[scope]))) {
    throw new VisaValidationError('Answers refer to an applicant who is not on this application');
  }
  const missing: string[] = [];
  for (const section of form.sections) for (const field of section.fields) {
    const targets = field.applicantScope === 'APPLICATION' ? ['application'] : applicantIds;
    for (const scope of targets) {
      const scopeAnswers = field.applicantScope === 'APPLICATION'
        ? answers.application ?? {}
        : { ...(answers.application ?? {}), ...(answers[scope] ?? {}) };
      const present = Object.hasOwn(scopeAnswers, field.key) && scopeAnswers[field.key] !== '' && scopeAnswers[field.key] !== null && scopeAnswers[field.key] !== undefined;
      if (!conditionMatches(field.visibleWhen, scopeAnswers)) continue;
      if (!present) { if (requireRequired && field.required) missing.push(`${section.label}: ${field.label}`); continue; }
      if (!validValue(field, scopeAnswers[field.key])) throw new VisaValidationError(`Check the answer for ${section.label}: ${field.label}`);
    }
    for (const scope of scopes) if (answers[scope] && Object.keys(answers[scope]).some((key) => key === field.key) && !targets.includes(scope)) {
      throw new VisaValidationError(`${field.label} must be answered in its configured section`);
    }
  }
  const allowed = new Set(form.sections.flatMap((section) => section.fields.map((field) => field.key)));
  if (Object.values(answers).some((scope) => Object.keys(scope).some((key) => !allowed.has(key)))) throw new VisaValidationError('The application contains an unknown question');
  return missing;
}
