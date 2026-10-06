import pino from 'pino';

export function createLogger(environment: 'development' | 'test' | 'production') {
  return pino({
    level: environment === 'test' ? 'silent' : 'info',
    base: { service: 'flyseri-api' },
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie', 'headers.authorization',
        'headers.cookie', 'password', 'token', 'apiKey', 'secret',
        'DATABASE_URL', 'REDIS_URL', 'SUPABASE_SERVICE_ROLE_KEY',
        'SABRE_CLIENT_SECRET', 'SABRE_PASSWORD', 'accessToken', 'access_token',
        'TRAVELLER_DATA_ENCRYPTION_KEY', 'SUPABASE_STORAGE_SECRET_KEY',
        'documentNumber', 'passport', 'passports', 'req.body',
      ],
      censor: '[REDACTED]',
    },
  });
}

export type FlyseriLogger = ReturnType<typeof createLogger>;
