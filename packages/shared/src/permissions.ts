export const PERMISSIONS = [
  'users:manage',
  'roles:manage',
  'tickets:read',
  'tickets:write',
  'tickets:manage_all',
  'assets:read',
  'assets:manage',
  'channels:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_ROLES: Record<string, Permission[]> = {
  admin: [
    'users:manage',
    'roles:manage',
    'tickets:read',
    'tickets:write',
    'tickets:manage_all',
    'assets:read',
    'assets:manage',
    'channels:manage',
  ],
  team_lead: [
    'tickets:read',
    'tickets:write',
    'tickets:manage_all',
    'assets:read',
    'assets:manage',
    'channels:manage',
  ],
  agent: ['tickets:read', 'tickets:write', 'assets:read'],
};
