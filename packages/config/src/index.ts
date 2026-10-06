import { z } from 'zod';

const urlWithProtocol = (protocols: string[]) => z.string().url().refine(
  (value) => protocols.includes(new URL(value).protocol),
  { message: `Expected ${protocols.join(' or ')} URL` },
);

const configSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: urlWithProtocol(['http:', 'https:']).refine(
    (value) => new URL(value).origin === value,
    { message: 'Expected an origin without a path' },
  ).default('http://localhost:8443'),
  DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']).optional(),
  REDIS_URL: urlWithProtocol(['redis:', 'rediss:']).optional(),
  SUPABASE_URL: urlWithProtocol(['https:']).refine((value) => new URL(value).origin === value, { message: 'Expected an HTTPS origin' }).optional(),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_STORAGE_SECRET_KEY: z.string().min(20).optional(),
  DOCUMENT_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/).default('travel-documents'),
  TRAVELLER_DATA_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  DOCUMENT_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(25).default(10),
  DOCUMENT_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
  SABRE_ENV: z.enum(['CERT', 'PROD']).default('CERT'),
  SABRE_BASE_URL: urlWithProtocol(['https:']).optional(),
  SABRE_AUTH_URL: urlWithProtocol(['https:']).optional(),
  SABRE_CLIENT_ID: z.string().min(1).optional(),
  SABRE_CLIENT_SECRET: z.string().min(1).optional(),
  SABRE_USERNAME: z.string().min(1).optional(),
  SABRE_PASSWORD: z.string().min(1).optional(),
  SABRE_PCC: z.string().min(2).max(8).optional(),
  SABRE_TOKEN_EXPIRY_SKEW_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  SABRE_BFM_CACHE_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
  SABRE_SEARCH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
  SABRE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(15000).default(12000),
  SABRE_SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(12),
  SABRE_PROVIDER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(120),
  SABRE_PROVIDER_MAX_CONCURRENT: z.coerce.number().int().min(1).max(100).default(12),
  SABRE_CACHE_WARMUP_ENABLED: z.enum(['true','false']).default('false').transform(value=>value==='true'),
  SABRE_CACHE_WARMUP_SEARCHES_PER_MINUTE: z.coerce.number().int().min(1).max(2).default(1),
  SABRE_CACHE_WARMUP_MAX_ROUTES: z.coerce.number().int().min(1).max(5).default(3),
  SABRE_VERBOSE_SEARCH_LOGGING: z.enum(['true','false']).default('false').transform(value=>value==='true'),
  SABRE_SHOPPING_POLICY_VERSION: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).default('2'),
  FLIGHT_BOOKING_INTENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(20),
  FLIGHT_VALIDATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(6),
  FLIGHT_VALIDATION_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(180),
  FLIGHT_BOOKING_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  SABRE_BOOKING_AGENCY: z.string().min(1).optional(),
  FLIGHT_TICKETING_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  SABRE_TICKETING_PROFILE: z.string().min(1).optional(),
  FLIGHT_ANCILLARY_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  // Approved merchant checkout rates, not the public display-only FX feed.
  FLIGHT_EXTRA_CHECKOUT_FX_RATES: z.string().min(1).optional(),
  PAYMENT_PROVIDER: z.enum(['NONE', 'STRIPE_TEST']).default('NONE'),
  PAYMENT_CHECKOUT_ENABLED: z.enum(['true', 'false']).default('false'),
  STRIPE_SECRET_KEY: z.string().regex(/^sk_test_[A-Za-z0-9]+$/).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9]+$/).optional(),
  SERI_AI_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SERI_AI_STREAMING_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SERI_AI_WRITE_TOOLS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SERI_AI_FALLBACK_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  AI_PRIMARY_PROVIDER: z.enum(['GEMINI', 'OPENAI']).default('GEMINI'),
  AI_PRIMARY_MODEL: z.string().min(1).max(120).default('gemini-3.8-flash'),
  AI_FALLBACK_PROVIDER: z.enum(['GEMINI', 'OPENAI']).optional(),
  AI_FALLBACK_MODEL: z.string().min(1).max(120).optional(),
  GEMINI_API_KEY: z.string().min(20).optional(),
  OPENAI_API_KEY: z.string().min(20).optional(),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  AI_RATE_LIMIT_MESSAGES_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(12),
  AI_RATE_LIMIT_TOOL_CALLS_PER_MINUTE: z.coerce.number().int().min(1).max(240).default(24),
  AI_MAX_TOOL_CALLS_PER_TURN: z.coerce.number().int().min(1).max(8).default(4),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8192).default(900),
  AI_MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(4).max(40).default(16),
  B2C_ADMIN_SHARED_SECRET: z.string().min(32).optional(),
  CRM_SYNC_URL: urlWithProtocol(['https:', 'http:']).refine((value) => {
    const url = new URL(value);
    return url.pathname === '/api/internal/flyseri-events' && !url.search && !url.hash &&
      (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname));
  }, { message: 'Expected HTTPS CRM event endpoint or localhost development endpoint' }).optional(),
  CRM_SYNC_SHARED_SECRET: z.string().min(32).optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function parseConfig(input: Record<string, unknown>): AppConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid Flyseri configuration: ${fields}`);
  }
  if (parsed.data.APP_ENV === 'production' && !input.WEB_ORIGIN) {
    throw new Error('Invalid Flyseri configuration: WEB_ORIGIN is required in production');
  }
  if (parsed.data.APP_ENV === 'production') {
    const missing = (['DATABASE_URL', 'REDIS_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_STORAGE_SECRET_KEY'] as const).filter((name) => !parsed.data[name]);
    if (missing.length) throw new Error(`Invalid Flyseri configuration: ${missing.join(', ')} required in production`);
  }
  const sabreFields = ['SABRE_BASE_URL', 'SABRE_AUTH_URL', 'SABRE_CLIENT_ID', 'SABRE_CLIENT_SECRET', 'SABRE_USERNAME', 'SABRE_PASSWORD', 'SABRE_PCC'] as const;
  const configured = sabreFields.filter((name) => parsed.data[name]);
  if (configured.length && (parsed.data.SABRE_ENV !== 'CERT' || parsed.data.SABRE_BASE_URL !== 'https://api.cert.platform.sabre.com' || parsed.data.SABRE_AUTH_URL !== 'https://api.cert.platform.sabre.com/v3/auth/token')) {
    throw new Error('Invalid Flyseri configuration: this trial permits Sabre CERT endpoints only');
  }
  if (configured.length > 0 && configured.length !== sabreFields.length) throw new Error('Invalid Flyseri configuration: incomplete Sabre configuration');
  if (Boolean(parsed.data.CRM_SYNC_URL) !== Boolean(parsed.data.CRM_SYNC_SHARED_SECRET)) {
    throw new Error('Invalid Flyseri configuration: CRM_SYNC_URL and CRM_SYNC_SHARED_SECRET must be configured together');
  }
  if (parsed.data.FLIGHT_BOOKING_EXECUTION_ENABLED === 'true' && (parsed.data.SABRE_ENV !== 'CERT' || configured.length !== sabreFields.length || !parsed.data.SABRE_BOOKING_AGENCY || parsed.data.APP_ENV === 'production')) {
    throw new Error('Invalid Flyseri configuration: reservation creation requires CERT credentials, approved agency configuration and a non-production environment');
  }
  if (parsed.data.FLIGHT_TICKETING_EXECUTION_ENABLED === 'true' && (parsed.data.SABRE_ENV !== 'CERT' || configured.length !== sabreFields.length || !parsed.data.SABRE_TICKETING_PROFILE || parsed.data.APP_ENV === 'production')) {
    throw new Error('Invalid Flyseri configuration: ticket issuance requires CERT credentials, an approved ticketing profile and a non-production environment');
  }
  if (parsed.data.FLIGHT_ANCILLARY_EXECUTION_ENABLED === 'true' && (parsed.data.FLIGHT_BOOKING_EXECUTION_ENABLED !== 'true' || parsed.data.FLIGHT_TICKETING_EXECUTION_ENABLED !== 'true' || parsed.data.SABRE_ENV !== 'CERT' || parsed.data.APP_ENV === 'production')) {
    throw new Error('Invalid Flyseri configuration: ancillary execution requires approved CERT reservation and non-cash ticketing configuration');
  }
  if (parsed.data.PAYMENT_CHECKOUT_ENABLED === 'true' && (parsed.data.PAYMENT_PROVIDER !== 'STRIPE_TEST' ||
      !parsed.data.STRIPE_SECRET_KEY || parsed.data.APP_ENV === 'production')) {
    throw new Error('Invalid Flyseri configuration: Stripe test checkout requires a test secret and non-production environment');
  }
  return parsed.data;
}
