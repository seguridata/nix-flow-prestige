import { describe, expect, it } from 'vitest';
import {
  collectNotificationKeys,
  collectOutboxKeys,
  deriveNotificationTenant,
  deriveOutboxTenant,
  formatSummary,
  newSummary,
  parseArgs,
  parseHref,
  record,
  OUTBOX_RULES,
  type Lookups,
} from '../../prisma/scripts/backfill-tenant-ids.lib';

const lk = (over: Partial<Lookups> = {}): Lookups => ({
  requestTenant: new Map(),
  documentTenant: new Map(),
  onboardingTenant: new Map(),
  emailTenants: new Map(),
  userTenants: new Map(),
  ...over,
});

const REQ_A = 'req-aaaaaaaa';
const REQ_B = 'req-bbbbbbbb';

describe('deriveOutboxTenant', () => {
  const base = { id: 'o1', toAddress: 'x@y.com', payload: null };

  it('regla dedupeKey: usa el tenant de la solicitud', () => {
    for (const p of ['invite', 'reminder', 'escalation', 'completed']) {
      const d = deriveOutboxTenant(
        { ...base, dedupeKey: `${p}:${REQ_A}:u1` },
        lk({ requestTenant: new Map([[REQ_A, 'acme']]) }),
      );
      expect(d).toEqual({ tenantId: 'acme', rule: 'outbox:dedupeKey' });
    }
  });

  it('regla payload.signatureRequestId', () => {
    const d = deriveOutboxTenant(
      { ...base, dedupeKey: null, payload: { signatureRequestId: REQ_A } },
      lk({ requestTenant: new Map([[REQ_A, 'acme']]) }),
    );
    expect(d).toEqual({ tenantId: 'acme', rule: 'outbox:payload' });
  });

  it('dedupeKey y payload con tenants distintos -> ambigua', () => {
    const d = deriveOutboxTenant(
      { ...base, dedupeKey: `invite:${REQ_A}:u`, payload: { signatureRequestId: REQ_B } },
      lk({ requestTenant: new Map([[REQ_A, 'acme'], [REQ_B, 'beta']]) }),
    );
    expect(d).toMatchObject({ tenantId: null, unresolved: 'ambigua' });
  });

  it('regla toAddress: un solo tenant candidato (sin distinguir mayúsculas)', () => {
    const d = deriveOutboxTenant(
      { ...base, toAddress: 'Ana@Acme.com', dedupeKey: null },
      lk({ emailTenants: new Map([['ana@acme.com', new Set(['acme'])]]) }),
    );
    expect(d).toEqual({ tenantId: 'acme', rule: 'outbox:toAddress' });
  });

  it('regla toAddress con varios tenants -> null ambigua', () => {
    const d = deriveOutboxTenant(
      { ...base, toAddress: 'ana@acme.com', dedupeKey: null },
      lk({ emailTenants: new Map([['ana@acme.com', new Set(['acme', 'beta'])]]) }),
    );
    expect(d).toEqual({ tenantId: null, rule: null, unresolved: 'ambigua' });
  });

  it('dedupeKey con solicitud inexistente cae al correo; sin nada -> sin_pistas', () => {
    expect(deriveOutboxTenant({ ...base, dedupeKey: `invite:${REQ_A}:u` }, lk())).toEqual({
      tenantId: null,
      rule: null,
      unresolved: 'sin_pistas',
    });
    expect(deriveOutboxTenant({ ...base, dedupeKey: 'otro:cosa' }, lk()).unresolved).toBe('sin_pistas');
  });

  it('el dedupeKey tiene prioridad sobre el correo', () => {
    const d = deriveOutboxTenant(
      { ...base, dedupeKey: `invite:${REQ_A}:u` },
      lk({
        requestTenant: new Map([[REQ_A, 'acme']]),
        emailTenants: new Map([['x@y.com', new Set(['beta'])]]),
      }),
    );
    expect(d.tenantId).toBe('acme');
  });
});

describe('deriveNotificationTenant', () => {
  it('href /documents/<id> -> tenant del documento (con sufijo/query)', () => {
    const l = lk({ documentTenant: new Map([['doc-11111111', 'acme']]) });
    for (const href of ['/documents/doc-11111111', '/documents/doc-11111111/firmar?x=1']) {
      expect(deriveNotificationTenant({ id: 'n', userId: 'u', href }, l)).toEqual({
        tenantId: 'acme',
        rule: 'notif:href',
      });
    }
  });

  it('href /onboarding/<id>', () => {
    const d = deriveNotificationTenant(
      { id: 'n', userId: 'u', href: '/onboarding/onb-11111111' },
      lk({ onboardingTenant: new Map([['onb-11111111', 'beta']]) }),
    );
    expect(d).toEqual({ tenantId: 'beta', rule: 'notif:href' });
  });

  it('href tiene prioridad sobre la membresía', () => {
    const d = deriveNotificationTenant(
      { id: 'n', userId: 'u', href: '/documents/doc-11111111' },
      lk({
        documentTenant: new Map([['doc-11111111', 'acme']]),
        userTenants: new Map([['u', new Set(['beta', 'gamma'])]]),
      }),
    );
    expect(d.tenantId).toBe('acme');
  });

  it('sin href útil: membresía en un solo tenant', () => {
    const d = deriveNotificationTenant(
      { id: 'n', userId: 'u', href: '/inbox' },
      lk({ userTenants: new Map([['u', new Set(['acme'])]]) }),
    );
    expect(d).toEqual({ tenantId: 'acme', rule: 'notif:membresia' });
  });

  it('membresía en varios tenants -> null ambigua; usuario desconocido -> sin_pistas', () => {
    const l = lk({ userTenants: new Map([['u', new Set(['acme', 'beta'])]]) });
    expect(deriveNotificationTenant({ id: 'n', userId: 'u', href: '/inbox' }, l)).toEqual({
      tenantId: null,
      rule: null,
      unresolved: 'ambigua',
    });
    expect(deriveNotificationTenant({ id: 'n', userId: 'z', href: null }, l).unresolved).toBe('sin_pistas');
  });

  it('href a documento inexistente cae a la membresía', () => {
    const d = deriveNotificationTenant(
      { id: 'n', userId: 'u', href: '/documents/doc-99999999' },
      lk({ userTenants: new Map([['u', new Set(['acme'])]]) }),
    );
    expect(d.rule).toBe('notif:membresia');
  });
});

describe('utilidades', () => {
  it('parseHref rechaza rutas ajenas', () => {
    expect(parseHref('/inbox')).toBeNull();
    expect(parseHref('https://x/documents/doc-11111111')).toBeNull();
    expect(parseHref(null)).toBeNull();
  });

  it('collect*Keys reúne las claves a consultar', () => {
    const k = collectOutboxKeys([
      { id: '1', toAddress: 'A@B.com', dedupeKey: `invite:${REQ_A}:u`, payload: { signatureRequestId: REQ_B } },
    ]);
    expect([...k.requestIds].sort()).toEqual([REQ_A, REQ_B]);
    expect([...k.emails]).toEqual(['a@b.com']);
    const n = collectNotificationKeys([{ id: '1', userId: 'u', href: '/documents/doc-11111111' }]);
    expect([...n.documentIds]).toEqual(['doc-11111111']);
    expect([...n.userIds]).toEqual(['u']);
  });

  it('parseArgs y resumen en español', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, help: false, errors: [] });
    expect(parseArgs(['--x']).errors).toHaveLength(1);
    const s = newSummary();
    record(s, { tenantId: 'a', rule: 'outbox:dedupeKey' });
    record(s, { tenantId: null, rule: null, unresolved: 'ambigua' });
    const txt = formatSummary('NotificationOutbox', s, OUTBOX_RULES, true);
    expect(txt).toContain('outbox:dedupeKey: 1 se asignarían');
    expect(txt).toContain('ambiguas (siguen NULL, requieren revisión manual): 1');
  });

  it('idempotencia: tras asignar, la fila ya no se reprocesa (el script filtra tenantId NULL); la derivación es determinista', () => {
    const l = lk({ requestTenant: new Map([[REQ_A, 'acme']]) });
    const row = { id: 'o', toAddress: 'x@y.com', dedupeKey: `invite:${REQ_A}:u`, payload: null };
    expect(deriveOutboxTenant(row, l)).toEqual(deriveOutboxTenant(row, l));
  });
});
