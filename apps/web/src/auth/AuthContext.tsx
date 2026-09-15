import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { apiPost, getToken, setToken } from '../lib/api';
import type { Permission } from '../lib/types';

interface TokenPayload {
  sub: string;
  tenantId: string;
  permissions: Permission[];
}

interface AuthContextValue {
  payload: TokenPayload | null;
  hasPermission: (permission: Permission) => boolean;
  login: (input: { tenantSlug: string; email: string; password: string }) => Promise<void>;
  register: (input: {
    tenantSlug: string;
    tenantName: string;
    adminEmail: string;
    adminName: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Decoded client-side purely to drive UI (show/hide a nav item, label a role) --
// never trusted for authorization, which the API re-checks against the DB on every
// request regardless of what this payload claims.
function decodeToken(token: string): TokenPayload | null {
  try {
    const [, payloadSegment] = token.split('.');
    const json = atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as TokenPayload;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<TokenPayload | null>(() => {
    const token = getToken();
    return token ? decodeToken(token) : null;
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      payload,
      hasPermission: (permission) => payload?.permissions.includes(permission) ?? false,
      login: async (input) => {
        const { token } = await apiPost<{ token: string }>('/auth/login', input);
        setToken(token);
        setPayload(decodeToken(token));
      },
      register: async (input) => {
        const { token } = await apiPost<{ token: string }>('/auth/register', input);
        setToken(token);
        setPayload(decodeToken(token));
      },
      logout: () => {
        setToken(null);
        setPayload(null);
      },
    }),
    [payload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
