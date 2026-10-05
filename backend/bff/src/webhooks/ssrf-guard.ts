import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Defensa SSRF para las URLs de webhook (las configura un admin de tenant pero
 * el BFF las llama desde dentro de la red: metadata cloud, Postgres, Redis…).
 *
 * - Solo http(s); en producción solo https.
 * - Se resuelve el DNS y se rechaza si CUALQUIER dirección es privada,
 *   loopback, link-local (incluye 169.254.169.254), CGNAT, multicast, etc.
 * - Escape de desarrollo: `WEBHOOK_ALLOW_PRIVATE=true` fuera de producción.
 *
 * Límite conocido: entre esta validación y el `fetch` hay una ventana de DNS
 * rebinding. Mitigación completa = fijar la IP validada en el socket
 * (undici Agent con `connect.lookup`); se valida otra vez en cada despacho.
 */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const defaultResolver: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

export class UnsafeWebhookUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
}

function inV4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** Expande una IPv6 a 8 grupos de 16 bits (maneja `::` y sufijo IPv4). */
function expandV6(ip: string): number[] | null {
  let addr = ip.split('%')[0]!.toLowerCase();
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    addr = addr.slice(0, -v4[1]!.length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return BLOCKED_V4.some(([base, bits]) => inV4(ip, base, bits));
  if (kind === 6) {
    const g = expandV6(ip);
    if (!g) return true; // no se pudo interpretar: fail-closed
    const [a, b] = g as [number, number];
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((a & 0xff00) === 0xff00) return true; // multicast
    if (a === 0x2001 && b === 0x0db8) return true; // documentación
    // IPv4 embebida: ::ffff:a.b.c.d, ::a.b.c.d y NAT64 64:ff9b::/96
    const embedded =
      (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) ||
      g.slice(0, 6).every((x) => x === 0) ||
      (a === 0x64 && b === 0xff9b && g.slice(2, 6).every((x) => x === 0));
    if (embedded) {
      const v4 = `${g[6]! >>> 8}.${g[6]! & 0xff}.${g[7]! >>> 8}.${g[7]! & 0xff}`;
      return isPrivateAddress(v4);
    }
    return false;
  }
  return true; // no es una IP válida
}

export async function assertSafeWebhookUrl(
  rawUrl: string,
  resolve: HostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError('URL de webhook inválida');
  }
  const production = process.env.NODE_ENV === 'production';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) {
    throw new UnsafeWebhookUrlError(
      production ? 'En producción el webhook debe usar https' : 'Solo se permiten URLs http(s)',
    );
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError('La URL del webhook no puede traer credenciales');
  }
  if (!production && process.env.WEBHOOK_ALLOW_PRIVATE === 'true') return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new UnsafeWebhookUrlError(`No se pudo resolver el host ${host}`);
    }
  }
  if (addresses.length === 0) throw new UnsafeWebhookUrlError(`El host ${host} no resuelve`);
  const bad = addresses.find(isPrivateAddress);
  if (bad) {
    throw new UnsafeWebhookUrlError('La URL del webhook apunta a una dirección interna o reservada');
  }
  return url;
}
