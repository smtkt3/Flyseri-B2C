import { Redis } from 'ioredis';

export interface RedisCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
  connect?(): Promise<unknown>;
  status?: string;
  eval?: Redis['eval'];
}

export function redisKey(environment: 'development' | 'test' | 'production', key: string): string {
  if (!key || key.startsWith(':')) throw new Error('Redis key must be non-empty and relative');
  return `flyseri:${environment === 'production' ? 'prod' : environment === 'development' ? 'dev' : 'test'}:${key}`;
}

export class RedisStore {
  constructor(
    private readonly commands: RedisCommands,
    private readonly environment: 'development' | 'test' | 'production',
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  async health(): Promise<boolean> {
    try {
      if (this.commands.connect && this.commands.status === 'wait') await this.commands.connect();
      return (await this.commands.ping()) === 'PONG';
    }
    catch { return false; }
  }

  async getJson<T>(key: string): Promise<T | undefined> {
    try {
      const value = await this.commands.get(redisKey(this.environment, key));
      return value === null ? undefined : JSON.parse(value) as T;
    } catch {
      this.warn('Redis cache read unavailable');
      return undefined;
    }
  }

  async readJson<T>(key: string): Promise<{ state: 'hit'; value: T } | { state: 'miss' | 'malformed' | 'unavailable' }> {
    try {
      const value = await this.commands.get(redisKey(this.environment, key));
      if (value === null) return { state: 'miss' };
      try { return { state: 'hit', value: JSON.parse(value) as T }; }
      catch { return { state: 'malformed' }; }
    } catch {
      this.warn('Redis cache read unavailable');
      return { state: 'unavailable' };
    }
  }

  async tryLock(key: string, owner: string, ttlMs: number): Promise<'acquired' | 'busy' | 'unavailable'> {
    if (!this.commands.eval || !Number.isInteger(ttlMs) || ttlMs < 100) return 'unavailable';
    try {
      const result = await this.commands.eval("return redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[2],'NX')", 1, redisKey(this.environment, `lock:${key}`), owner, ttlMs);
      return result === 'OK' ? 'acquired' : 'busy';
    } catch { this.warn('Redis lock unavailable'); return 'unavailable'; }
  }

  async releaseLock(key: string, owner: string): Promise<boolean> {
    if (!this.commands.eval) return false;
    try {
      const result = await this.commands.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, redisKey(this.environment, `lock:${key}`), owner);
      return result === 1;
    } catch { this.warn('Redis lock release unavailable'); return false; }
  }

  async trySemaphore(key: string, owner: string, limit: number, ttlMs: number): Promise<'acquired' | 'busy' | 'unavailable'> {
    if (!this.commands.eval || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(ttlMs) || ttlMs < 100) return 'unavailable';
    const script = "local now=tonumber(ARGV[1]); redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now); if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[3]) then return 0 end; redis.call('ZADD',KEYS[1],now+tonumber(ARGV[2]),ARGV[4]); redis.call('PEXPIRE',KEYS[1],ARGV[2]); return 1";
    try {
      const result = await this.commands.eval(script, 1, redisKey(this.environment, `semaphore:${key}`), Date.now(), ttlMs, limit, owner);
      return result === 1 ? 'acquired' : 'busy';
    } catch { this.warn('Redis semaphore unavailable'); return 'unavailable'; }
  }

  async releaseSemaphore(key: string, owner: string): Promise<boolean> {
    if (!this.commands.eval) return false;
    try {
      return await this.commands.eval("return redis.call('ZREM',KEYS[1],ARGV[1])", 1, redisKey(this.environment, `semaphore:${key}`), owner) === 1;
    } catch { this.warn('Redis semaphore release unavailable'); return false; }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error('Redis TTL must be a positive integer');
    try {
      await this.commands.set(redisKey(this.environment, key), JSON.stringify(value), 'EX', ttlSeconds);
      return true;
    } catch {
      this.warn('Redis cache write unavailable');
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try { await this.commands.del(redisKey(this.environment, key)); return true; }
    catch { this.warn('Redis cache delete unavailable'); return false; }
  }

  async deleteJsonIfFingerprint(key: string, fingerprint: string): Promise<boolean> {
    if (!this.commands.eval) return false;
    const script = "local value=redis.call('GET',KEYS[1]); if not value then return 0 end; local ok,data=pcall(cjson.decode,value); if ok and data.fingerprint==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0";
    try { return await this.commands.eval(script, 1, redisKey(this.environment, key), fingerprint) === 1; }
    catch { this.warn('Redis conditional delete unavailable'); return false; }
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<'allowed' | 'limited' | 'unavailable'> {
    if (!this.commands.eval) return 'unavailable';
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) throw new Error('Invalid rate limit');
    const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[2]) end; return n";
    try {
      const count = await this.commands.eval(script, 1, redisKey(this.environment, `rate:${key}`), limit, windowSeconds);
      return typeof count === 'number' ? count > limit ? 'limited' : 'allowed' : 'unavailable';
    } catch {
      this.warn('Redis rate limiter unavailable');
      return 'unavailable';
    }
  }

  async incrementCounter(key: string): Promise<number | null> {
    if (!this.commands.eval) return null;
    try {
      const value = await this.commands.eval("return redis.call('INCR',KEYS[1])", 1, redisKey(this.environment, key));
      return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
    } catch { this.warn('Redis telemetry counter unavailable'); return null; }
  }

  async readCounter(key: string): Promise<number | null> {
    try {
      const value = await this.commands.get(redisKey(this.environment, key));
      if (value === null) return 0;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    } catch { this.warn('Redis telemetry counter unavailable'); return null; }
  }

  async close(): Promise<void> {
    if (this.commands.status === 'wait' || this.commands.status === 'end') return;
    await this.commands.quit();
  }
}

export function createRedisStore(url: string, environment: 'development' | 'test' | 'production', warn?: (message: string) => void): RedisStore {
  const client = new Redis(url, { connectTimeout: 2000, maxRetriesPerRequest: 1, keepAlive: 10000,
    retryStrategy: attempt => Math.min(250 * 2 ** Math.min(attempt - 1, 4), 3000), enableOfflineQueue: false });
  client.on('error', () => warn?.('Redis connection unavailable'));
  return new RedisStore(client, environment, warn);
}
