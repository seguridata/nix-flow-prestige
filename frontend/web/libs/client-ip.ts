import { isIP } from "node:net";

/**
 * IP real del cliente para el portal público de firma.
 *
 * El proxy sin sesión descarta el `x-forwarded-for` entrante (el cliente podría
 * falsearlo). Sin reponer una IP, el BFF ve la de este servidor Next: todos los
 * firmantes externos comparten un solo cubo del throttler (20/min en total) y la
 * prueba de consentimiento guarda la IP equivocada.
 *
 * `hops` es la cantidad de proxies de confianza delante de Next (LB, ingress,
 * Cloudflare…); cada uno agrega la dirección que vio al final de la lista. La IP
 * del cliente es, por tanto, la entrada `hops` posiciones desde el final: lo que
 * esté antes lo controla el cliente y se ignora. Con `hops` 0 (por defecto, no
 * hay proxy de confianza declarado) no se confía en la cabecera.
 */
export function clientIpFromForwarded(forwardedFor: string | null, hops: number): string | undefined {
  if (!forwardedFor || !Number.isInteger(hops) || hops < 1) return undefined;
  const parts = forwardedFor
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - hops];
  return candidate && isIP(candidate) ? candidate : undefined;
}

/** Proxies de confianza delante de Next (`PUBLIC_TRUSTED_PROXY_HOPS`); 0 si no se declara. */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PUBLIC_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
