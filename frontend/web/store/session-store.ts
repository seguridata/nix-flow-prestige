import { create } from "zustand";

interface SessionState {
  signerId: string;
  name: string;
  email: string;
}

/**
 * Placeholder session until the Keycloak OIDC integration lands (M02).
 * Every screen reads the current user from here so swapping this store's
 * implementation for a real `useAuth()` hook is a one-file change.
 */
export const useSession = create<SessionState>(() => ({
  signerId: "maria",
  name: "María González",
  email: "maria@demo.local",
}));
