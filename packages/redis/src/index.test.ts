import { describe, expect, it, vi } from 'vitest';
import { redisKey, RedisStore, type RedisCommands } from './index.js';

describe('RedisStore', () => {
  it('namespaces keys and serializes values with a TTL', async () => {
    const commands: RedisCommands = {
      get: vi.fn().mockResolvedValue('{"ready":true}'),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      ping: vi.fn().mockResolvedValue('PONG'),
      quit: vi.fn().mockResolvedValue('OK'),
    };
    const store = new RedisStore(commands, 'development');
    expect(redisKey('development', 'sample')).toBe('flyseri:dev:sample');
    expect(await store.getJson<{ ready: boolean }>('sample')).toEqual({ ready: true });
    expect(await store.setJson('sample', { ready: true }, 30)).toBe(true);
    expect(commands.set).toHaveBeenCalledWith('flyseri:dev:sample', '{"ready":true}', 'EX', 30);
  });

  it('fails open for non-critical cache reads', async () => {
    const warn = vi.fn();
    const commands = { get: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as RedisCommands;
    expect(await new RedisStore(commands, 'test', warn).getJson('item')).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('uses expiring owner-checked locks and bounded semaphore slots', async () => {
    const locks = new Map<string, { owner: string; expires: number }>();
    const slots = new Map<string, Set<string>>();
    const evalFn = vi.fn(async (script: string, _keys: number, key: string, ...args: unknown[]) => {
      if (script.includes("'SET'")) {
        const current = locks.get(key);
        if (current && current.expires > Date.now()) return null;
        locks.set(key, { owner: String(args[0]), expires: Date.now() + Number(args[1]) }); return 'OK';
      }
      if (script.includes("'GET'")) {
        if (locks.get(key)?.owner !== args[0]) return 0;
        locks.delete(key); return 1;
      }
      if (script.includes('ZREMRANGEBYSCORE')) {
        const set = slots.get(key) ?? new Set<string>();
        if (set.size >= Number(args[2])) return 0;
        set.add(String(args[3])); slots.set(key, set); return 1;
      }
      if (script.includes('ZREM')) return slots.get(key)?.delete(String(args[0])) ? 1 : 0;
      return 0;
    });
    const store = new RedisStore({ eval: evalFn } as unknown as RedisCommands, 'test');
    expect(await store.tryLock('one', 'owner-a', 500)).toBe('acquired');
    expect(await store.tryLock('one', 'owner-b', 500)).toBe('busy');
    expect(await store.releaseLock('one', 'owner-b')).toBe(false);
    expect(await store.releaseLock('one', 'owner-a')).toBe(true);
    expect(await store.tryLock('one', 'owner-b', 500)).toBe('acquired');
    locks.get('flyseri:test:lock:one')!.expires = Date.now() - 1;
    expect(await store.tryLock('one', 'owner-c', 500)).toBe('acquired');
    expect(await store.trySemaphore('provider', 'a', 1, 500)).toBe('acquired');
    expect(await store.trySemaphore('provider', 'b', 1, 500)).toBe('busy');
    expect(await store.releaseSemaphore('provider', 'a')).toBe(true);
    expect(await store.trySemaphore('provider', 'b', 1, 500)).toBe('acquired');
    expect(evalFn).toHaveBeenCalled();
  });

  it('distinguishes malformed cache data from an outage', async () => {
    const get = vi.fn().mockResolvedValueOnce('{bad').mockRejectedValueOnce(new Error('offline'));
    const store = new RedisStore({ get } as unknown as RedisCommands, 'test');
    expect(await store.readJson('one')).toEqual({ state: 'malformed' });
    expect(await store.readJson('one')).toEqual({ state: 'unavailable' });
  });

  it('increments and reads an aggregate counter in the environment namespace', async () => {
    const evalFn = vi.fn().mockResolvedValue(7);
    const get = vi.fn().mockResolvedValue('7');
    const store = new RedisStore({ eval: evalFn, get } as unknown as RedisCommands, 'test');
    expect(await store.incrementCounter('metrics:ai_rate_limited_total')).toBe(7);
    expect(evalFn).toHaveBeenCalledWith("return redis.call('INCR',KEYS[1])", 1, 'flyseri:test:metrics:ai_rate_limited_total');
    expect(await store.readCounter('metrics:ai_rate_limited_total')).toBe(7);
    expect(get).toHaveBeenCalledWith('flyseri:test:metrics:ai_rate_limited_total');
  });
});
