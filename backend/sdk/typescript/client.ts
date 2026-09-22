/**
 * SDK TypeScript de Prestige (M14). Cliente fino y tipado sobre `schema.d.ts`
 * (generado desde el OpenAPI real del BFF con `bun run sdk:gen`).
 *
 *   import { PrestigeClient } from './client';
 *   const api = new PrestigeClient({ baseUrl: 'https://bff...', token });
 *   const cases = await api.get('/cases');
 *
 * `path` y las formas de request/response las valida `schema.d.ts`; para
 * regenerarlas tras un cambio de contrato: `cd backend/bff && bun run sdk:gen`.
 */
import type { paths } from './schema';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type PathsWith<M extends Method> = {
  [P in keyof paths]: paths[P] extends Record<M, unknown> ? P : never;
}[keyof paths];

type Json<T> = T extends { content: { 'application/json': infer J } } ? J : unknown;
type Ok<R> = R extends { responses: infer Res }
  ? Res extends Record<200 | 201, infer S>
    ? Json<S>
    : unknown
  : unknown;
type Body<R> = R extends { requestBody: { content: { 'application/json': infer B } } } ? B : undefined;

export interface PrestigeClientOptions {
  baseUrl: string;
  /** Bearer de Keycloak (patrón BFF: nunca lo ve el navegador del firmante externo). */
  token?: string;
  fetch?: typeof fetch;
}

export class PrestigeError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Prestige API ${status}`);
  }
}

export class PrestigeClient {
  constructor(private readonly opts: PrestigeClientOptions) {}

  private async call(method: Method, path: string, body?: unknown, query?: Record<string, string>) {
    const f = this.opts.fetch ?? fetch;
    const url = new URL(this.opts.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await f(url, {
      method: method.toUpperCase(),
      headers: {
        ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new PrestigeError(res.status, parsed);
    return parsed;
  }

  get<P extends PathsWith<'get'>>(path: P, query?: Record<string, string>): Promise<Ok<paths[P]['get']>> {
    return this.call('get', path as string, undefined, query) as Promise<Ok<paths[P]['get']>>;
  }
  post<P extends PathsWith<'post'>>(path: P, body?: Body<paths[P]['post']>): Promise<Ok<paths[P]['post']>> {
    return this.call('post', path as string, body) as Promise<Ok<paths[P]['post']>>;
  }
  put<P extends PathsWith<'put'>>(path: P, body?: Body<paths[P]['put']>): Promise<Ok<paths[P]['put']>> {
    return this.call('put', path as string, body) as Promise<Ok<paths[P]['put']>>;
  }
  patch<P extends PathsWith<'patch'>>(path: P, body?: Body<paths[P]['patch']>): Promise<Ok<paths[P]['patch']>> {
    return this.call('patch', path as string, body) as Promise<Ok<paths[P]['patch']>>;
  }
  delete<P extends PathsWith<'delete'>>(path: P): Promise<Ok<paths[P]['delete']>> {
    return this.call('delete', path as string) as Promise<Ok<paths[P]['delete']>>;
  }
}

/**
 * Verifica la firma HMAC-SHA256 de un webhook de Prestige.
 * Cabecera: `X-Prestige-Signature: sha256=<hmac(`${timestamp}.${rawBody}`)>`.
 */
export async function verifyWebhookSignature(params: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signatureHeader: string;
}): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(params.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${params.timestamp}.${params.rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const got = params.signatureHeader.replace(/^sha256=/, '');
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
