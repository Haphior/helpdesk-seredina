export const PERMISSIONS = [
  'users:manage',
  'roles:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_ROLES: Record<string, Permission[]> = {
  admin: ['users:manage', 'roles:manage'],
  agent: [],
};
