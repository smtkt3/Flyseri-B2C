// Only return to known local chat routes; never accept an external redirect.
export function seriReturnPath(path: unknown): string | undefined {
  return typeof path === 'string' && (path === '/#book' || /^\/app\/(?:seri|trips\/[a-zA-Z0-9-]+\/seri)(?:\?conversation=[a-zA-Z0-9-]+)?$/.test(path)) ? path : undefined;
}
