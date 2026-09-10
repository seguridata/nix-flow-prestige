"use client";

import { createContext, useContext } from "react";

export interface SessionUser {
  /** identidad de negocio (= preferred_username del token) */
  signerId: string;
  name: string;
  email: string | null;
  roles: string[];
  tenantId: string;
}

export const SessionContext = createContext<SessionUser | null>(null);

/**
 * Usuario autenticado real (OIDC contra Keycloak, servido por `/api/auth/me`
 * a través de `SessionProvider`). Antes era un placeholder con "maria".
 */
export function useSession(): SessionUser {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession debe usarse dentro de <SessionProvider>");
  }
  return ctx;
}

export function useRoles(): string[] {
  return useSession().roles;
}

export function hasRole(user: SessionUser, ...roles: string[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}
