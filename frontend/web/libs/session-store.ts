import "server-only";
import Redis from "ioredis";
import type { Session } from "./auth";

/**
 * Almacén de sesión del lado del servidor. Los tokens de Keycloak (access +
 * refresh + id) juntos superan el límite de 4 KB de una cookie, así que la
 * cookie sólo lleva un `sid` firmado y el `Session` completo vive en Redis.
 *
 * Sin `REDIS_URL` cae al modo "todo en la cookie" (ver libs/auth.ts) — sólo
 * apto para entornos de un tenant y tokens pequeños.
 */

const TTL_SECONDS = 8 * 3600;

let client: Redis | null = null;

export function sessionStoreEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

function redis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    client.on("error", (e) => console.warn(`[session-store] redis: ${e.message}`));
  }
  return client;
}

const key = (sid: string) => `sess:${sid}`;

export async function putSession(sid: string, session: Session): Promise<void> {
  await redis().set(key(sid), JSON.stringify(session), "EX", TTL_SECONDS);
}

export async function readSession(sid: string): Promise<Session | null> {
  try {
    const raw = await redis().get(key(sid));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch (e) {
    console.warn(`[session-store] readSession: ${(e as Error).message}`);
    return null;
  }
}

export async function dropSession(sid: string): Promise<void> {
  try {
    await redis().del(key(sid));
  } catch {
    /* noop */
  }
}
