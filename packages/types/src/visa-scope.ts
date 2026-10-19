/** Customer visa assistance currently serves Bangladeshi nationals only. */
export const VISA_APPLICANT_NATIONALITY = 'BD';
export const VISA_DESTINATION_CODES = ['MY','TH','SG','AE','IN','SA','TR','CN','JP','GB','ID','PK','LK','LA','KH'] as const;
export function isSupportedVisaDestination(code: unknown): code is typeof VISA_DESTINATION_CODES[number] {
  return typeof code === 'string' && (VISA_DESTINATION_CODES as readonly string[]).includes(code);
}
