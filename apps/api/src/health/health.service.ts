import { Inject, Injectable } from '@nestjs/common';
import { DatabaseConnection } from '@flyseri/database';
import { RedisStore } from '@flyseri/redis';
import type { HealthResponse } from '@flyseri/types';
import { DATABASE_CONNECTION, REDIS_STORE } from '../tokens.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly database: DatabaseConnection | undefined,
    @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined,
  ) {}

  live(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async ready(): Promise<HealthResponse | null> {
    const [database, redis] = await Promise.all([
      this.database ? this.database.health().then((ok) => ok ? 'ok' as const : 'unavailable' as const) : 'unconfigured' as const,
      this.redis ? this.redis.health().then((ok) => ok ? 'ok' as const : 'unavailable' as const) : 'unconfigured' as const,
    ]);
    if (database === 'unavailable' || redis === 'unavailable') return null;
    return { status: 'ok', timestamp: new Date().toISOString(), services: { database, redis } };
  }
}
