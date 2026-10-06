/**
 * Lógica pura (sin BD ni process.*) de `backfill-tenant-ids.ts`: reglas
 * deterministas para derivar el tenant de filas de NotificationOutbox y
 * UserNotification con tenantId NULL. Se prueba en
 * src/workflow/backfill-tenant-ids.spec.ts.
 *
 * Principio: NUNCA adivinar. Cada regla devuelve un único tenant o nada; si
 * las pistas son ambiguas (varios tenants candidatos) el resultado es null.
 */

export const BATCH_SIZE = 500;

export type OutboxRule = 'outbox:dedupeKey' | 'outbox:payload' | 'outbox:toAddress';
export type NotificationRule = 'notif:href' | 'notif:membresia';
export type Rule = OutboxRule | NotificationRule;
export type Unresolved = 'ambigua' | 'sin_pistas';

export interface Derivation {
  tenantId: string | null;
  /** Regla que resolvió la fila; null si quedó sin resolver. */
  rule: Rule | null;
  /** Sólo si tenantId es null. */
  unresolved?: Unresolved;
}

export interface OutboxRow {
  id: string;
  toAddress: string;
  dedupeKey: string | null;
  payload: unknown;
}

export interface NotificationRow {
  id: string;
  userId: string;
  href: string | null;
}

/** Tablas de consulta ya resueltas por el script (una consulta por lote). */
export interface Lookups {
  requestTenant: ReadonlyMap<string, string>;
  documentTenant: ReadonlyMap<string, string>;
  onboardingTenant: ReadonlyMap<string, string>;
  /** correo (minúsculas) -> tenants candidatos (firmantes + membresías). */
  emailTenants: ReadonlyMap<string, ReadonlySet<string>>;
  /** userId -> tenants a los que pertenece. */
  userTenants: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface Keys {
  requestIds: Set<string>;
  documentIds: Set<string>;
  onboardingIds: Set<string>;
  emails: Set<string>;
  userIds: Set<string>;
}

const emptyKeys = (): Keys => ({
  requestIds: new Set(),
  documentIds: new Set(),
  onboardingIds: new Set(),
  emails: new Set(),
  userIds: new Set(),
});

/** Prefijos de dedupeKey de SignerMailService: `<tipo>:<signatureRequestId>:...`. */
const DEDUPE_PREFIXES = new Set(['invite', 'reminder', 'escalation', 'completed']);
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const HREF_RE = /^\/(documents|onboarding)\/([A-Za-z0-9_-]{8,64})(?:[/?#].*)?$/;

export const normEmail = (e: string): string => e.trim().toLowerCase();

export function requestIdFromDedupeKey(key: string | null): string | null {
  if (!key) return null;
  const [prefix, id] = key.split(':');
  return DEDUPE_PREFIXES.has(prefix) && id && ID_RE.test(id) ? id : null;
}

export function requestIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const v = (payload as Record<string, unknown>).signatureRequestId;
  return typeof v === 'string' && ID_RE.test(v) ? v : null;
}

export function parseHref(href: string | null): { kind: 'documents' | 'onboarding'; id: string } | null {
  if (!href) return null;
  const m = HREF_RE.exec(href.trim());
  return m ? { kind: m[1] as 'documents' | 'onboarding', id: m[2] } : null;
}

/** Claves a consultar en BD para un lote de filas. */
export function collectOutboxKeys(rows: OutboxRow[]): Keys {
  const k = emptyKeys();
  for (const r of rows) {
    const a = requestIdFromDedupeKey(r.dedupeKey);
    if (a) k.requestIds.add(a);
    const b = requestIdFromPayload(r.payload);
    if (b) k.requestIds.add(b);
    if (r.toAddress) k.emails.add(normEmail(r.toAddress));
  }
  return k;
}

export function collectNotificationKeys(rows: NotificationRow[]): Keys {
  const k = emptyKeys();
  for (const r of rows) {
    const h = parseHref(r.href);
    if (h?.kind === 'documents') k.documentIds.add(h.id);
    if (h?.kind === 'onboarding') k.onboardingIds.add(h.id);
    k.userIds.add(r.userId);
  }
  return k;
}

const resolved = (tenantId: string, rule: Rule): Derivation => ({ tenantId, rule });
const unresolved = (u: Unresolved): Derivation => ({ tenantId: null, rule: null, unresolved: u });

/**
 * Reglas por orden de confianza (la primera que aporta una pista decide):
 *  1. dedupeKey `<tipo>:<requestId>:…` -> SignatureRequest.tenantId
 *  2. payload.signatureRequestId       -> SignatureRequest.tenantId
 *  3. toAddress == correo de firmante/membresía, sólo si apunta a UN tenant
 * Si dos reglas aportan tenants distintos entre sí, es ambigua (no se elige).
 */
export function deriveOutboxTenant(row: OutboxRow, lk: Lookups): Derivation {
  const byKey = requestIdFromDedupeKey(row.dedupeKey);
  const byPayload = requestIdFromPayload(row.payload);
  const tKey = byKey ? lk.requestTenant.get(byKey) : undefined;
  const tPayload = byPayload ? lk.requestTenant.get(byPayload) : undefined;
  if (tKey && tPayload && tKey !== tPayload) return unresolved('ambigua');
  if (tKey) return resolved(tKey, 'outbox:dedupeKey');
  if (tPayload) return resolved(tPayload, 'outbox:payload');

  const cands = row.toAddress ? lk.emailTenants.get(normEmail(row.toAddress)) : undefined;
  if (cands && cands.size === 1) return resolved([...cands][0], 'outbox:toAddress');
  if (cands && cands.size > 1) return unresolved('ambigua');
  return unresolved('sin_pistas');
}

/**
 * Reglas por orden de confianza:
 *  1. href /documents/<id> o /onboarding/<id> -> tenant del Documento / Onboarding
 *  2. userId con membresía en UN solo tenant
 * Un href que apunta a un recurso inexistente cae a la regla 2.
 */
export function deriveNotificationTenant(row: NotificationRow, lk: Lookups): Derivation {
  const h = parseHref(row.href);
  if (h) {
    const t = (h.kind === 'documents' ? lk.documentTenant : lk.onboardingTenant).get(h.id);
    if (t) return resolved(t, 'notif:href');
  }
  const cands = lk.userTenants.get(row.userId);
  if (cands && cands.size === 1) return resolved([...cands][0], 'notif:membresia');
  if (cands && cands.size > 1) return unresolved('ambigua');
  return unresolved('sin_pistas');
}

export interface Summary {
  scanned: number;
  byRule: Partial<Record<Rule, number>>;
  ambiguas: number;
  sinPistas: number;
}

export const newSummary = (): Summary => ({ scanned: 0, byRule: {}, ambiguas: 0, sinPistas: 0 });

export function record(s: Summary, d: Derivation): void {
  s.scanned += 1;
  if (d.rule) s.byRule[d.rule] = (s.byRule[d.rule] ?? 0) + 1;
  else if (d.unresolved === 'ambigua') s.ambiguas += 1;
  else s.sinPistas += 1;
}

export function formatSummary(table: string, s: Summary, rules: Rule[], dryRun: boolean): string {
  const verbo = dryRun ? 'se asignarían' : 'asignadas';
  const lines = [`${table}: ${s.scanned} fila(s) con tenantId NULL revisadas`];
  for (const r of rules) lines.push(`  - ${r}: ${s.byRule[r] ?? 0} ${verbo}`);
  lines.push(`  - ambiguas (siguen NULL, requieren revisión manual): ${s.ambiguas}`);
  lines.push(`  - sin pistas (siguen NULL): ${s.sinPistas}`);
  return lines.join('\n');
}

export const OUTBOX_RULES: OutboxRule[] = ['outbox:dedupeKey', 'outbox:payload', 'outbox:toAddress'];
export const NOTIFICATION_RULES: NotificationRule[] = ['notif:href', 'notif:membresia'];

export function parseArgs(argv: string[]): { dryRun: boolean; help: boolean; errors: string[] } {
  const out = { dryRun: false, help: false, errors: [] as string[] };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a !== '--') out.errors.push(`Argumento desconocido: ${a}`);
  }
  return out;
}

export const USAGE = `Uso:
  bun run backfill:tenant-ids -- [--dry-run]

Rellena tenantId NULL en NotificationOutbox y UserNotification con reglas deterministas.
Idempotente (sólo toca filas con tenantId NULL); nunca adivina: lo ambiguo queda NULL.
  --dry-run   no escribe; sólo cuenta lo que haría por regla
  --help      muestra esta ayuda`;
