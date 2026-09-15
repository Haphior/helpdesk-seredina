import { Permission } from './permissions';

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  permissions: Permission[];
}
