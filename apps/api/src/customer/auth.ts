import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { AppConfig } from '@flyseri/config';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import type { CustomerStore } from './customer.repository.js';
import { APP_CONFIG, CUSTOMER_STORE, TOKEN_VERIFIER } from '../tokens.js';
import { ApiException } from '../api-exception.js';

export interface TokenVerifier { verify(token: string): Promise<{ authUserId: string } | null> }

export function createSupabaseVerifier(config: AppConfig): TokenVerifier | undefined {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return undefined;
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return {
    async verify(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      return { authUserId: data.user.id };
    },
  };
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUserContext => {
  const identity = context.switchToHttp().getRequest<ContextRequest>().identity;
  if (!identity) throw new ApiException('AUTHENTICATION_REQUIRED', 'Please sign in to continue.', 401);
  return identity;
});

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier | undefined,
    @Inject(CUSTOMER_STORE) private readonly store: CustomerStore | undefined,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new ApiException('AUTHENTICATION_REQUIRED', 'Please sign in to continue.', 401);
    if (!this.verifier || !this.store) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Customer accounts are temporarily unavailable.', 503);
    let verified: { authUserId: string } | null;
    try { verified = await this.verifier.verify(match[1]!); }
    catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Authentication is temporarily unavailable.', 503); }
    if (!verified || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(verified.authUserId)) {
      throw new ApiException('INVALID_SESSION', 'Your session has expired. Please sign in again.', 401);
    }
    const customer = await this.store.bootstrap(verified.authUserId);
    if (customer.status !== 'ACTIVE') throw new ApiException('FORBIDDEN', 'This account is unavailable.', 403);
    request.identity = { authUserId: verified.authUserId, customerId: customer.id, profile: customer.profile };
    return true;
  }
}

@Injectable()
export class OptionalCustomerAuthGuard implements CanActivate {
  constructor(@Inject(CustomerAuthGuard) private readonly customerAuth: CustomerAuthGuard) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const authorization = context.switchToHttp().getRequest<ContextRequest>().headers.authorization;
    return authorization === undefined ? true : this.customerAuth.canActivate(context);
  }
}
