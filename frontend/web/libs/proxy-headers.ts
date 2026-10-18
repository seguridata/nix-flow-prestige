/** Cabeceras de entrada que los proxies del BFF reenvían (lista blanca). */
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "content-length",
  "if-match",
  "if-none-match",
  "range",
  "idempotency-key",
  "x-request-id",
  "x-tenant-id",
]);

/** Copia solo las cabeceras permitidas; descarta x-forwarded-*, x-real-ip, x-user-*, x-actor-*, etc. */
export function filterRequestHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((v, k) => {
    if (ALLOWED_REQUEST_HEADERS.has(k.toLowerCase())) out.set(k, v);
  });
  return out;
}
