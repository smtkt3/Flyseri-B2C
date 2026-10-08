import { createHmac, timingSafeEqual } from 'node:crypto';
import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '@flyseri/config';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG } from '../tokens.js';

export type AdminRole = 'owner' | 'manager' | 'ticketing_staff' | 'payment_staff' | 'support_staff';
export type AdminPermission = 'overview' | 'customers' | 'travellers' | 'trips' | 'visa' | 'visa_pii' | 'visa_manage' | 'visa_configure' | 'documents' | 'document_content' | 'flights' | 'orders' | 'payments' | 'audit' | 'settings' | 'crm_links' | 'crm_sync' | 'ai_operations' | 'holidays';
export interface AdminIdentity { staffUserId: string; role: AdminRole }
type Claims = { iss: 'seri-mechan-crm'; aud: 'flyseri-admin'; sub: string; role: AdminRole; iat: number; exp: number };
type AdminRequest = { headers: { authorization?: string }; adminIdentity?: AdminIdentity };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles: AdminRole[] = ['owner', 'manager', 'ticketing_staff', 'payment_staff', 'support_staff'];
const permissions: Record<AdminRole, AdminPermission[]> = {
  owner: ['overview', 'customers', 'travellers', 'trips', 'visa', 'visa_pii', 'visa_manage', 'visa_configure', 'documents', 'document_content', 'flights', 'orders', 'payments', 'audit', 'settings', 'crm_links', 'crm_sync', 'ai_operations', 'holidays'],
  manager: ['overview', 'customers', 'travellers', 'trips', 'visa', 'visa_pii', 'visa_manage', 'visa_configure', 'documents', 'flights', 'orders', 'payments', 'audit', 'crm_links', 'crm_sync', 'ai_operations', 'holidays'],
  ticketing_staff: ['overview', 'customers', 'trips', 'flights', 'orders'],
  payment_staff: ['overview', 'orders', 'payments'],
  support_staff: ['overview', 'customers', 'travellers', 'trips', 'visa', 'visa_manage', 'documents'],
};
export const adminPermissions = (role: AdminRole): AdminPermission[] => [...permissions[role]];
export const RequireAdminPermission = (permission: AdminPermission) => SetMetadata('adminPermission', permission);
export const CurrentStaff = createParamDecorator((_data: unknown, context: ExecutionContext): AdminIdentity => {
  const identity = context.switchToHttp().getRequest<AdminRequest>().adminIdentity;
  if (!identity) throw new ApiException('AUTHENTICATION_REQUIRED', 'Staff sign-in is required.', 401);
  return identity;
});

export function verifyAdminToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): AdminIdentity | null {
  const [version, payload, signature, extra] = token.split('.');
  if (version !== 'v1' || !payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  const expected = createHmac('sha256', secret).update(`${version}.${payload}`).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  let claims: Partial<Claims>;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Claims>; } catch { return null; }
  if (claims.iss !== 'seri-mechan-crm' || claims.aud !== 'flyseri-admin' || !claims.sub || !uuid.test(claims.sub) ||
    !roles.includes(claims.role as AdminRole) || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
    claims.iat! > now + 5 || claims.iat! < now - 60 || claims.exp! <= now || claims.exp! > claims.iat! + 60) return null;
  return { staffUserId: claims.sub, role: claims.role as AdminRole };
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (!this.config.B2C_ADMIN_SHARED_SECRET) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Staff administration is not configured.', 503);
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    const identity = match ? verifyAdminToken(match[1]!, this.config.B2C_ADMIN_SHARED_SECRET) : null;
    if (!identity) throw new ApiException('AUTHENTICATION_REQUIRED', 'Staff sign-in is required.', 401);
    const permission = this.reflector.getAllAndOverride<AdminPermission>('adminPermission', [context.getHandler(), context.getClass()]);
    if (!permission || !permissions[identity.role].includes(permission)) throw new ApiException('FORBIDDEN', 'You do not have access to this area.', 403);
    request.adminIdentity = identity;
    return true;
  }
}
