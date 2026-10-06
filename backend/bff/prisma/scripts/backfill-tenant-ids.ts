/**
 * Backfill de tenantId para NotificationOutbox y UserNotification (la
 * migración p1_tenant_scoping no pudo derivarlo: no tienen padre directo).
 *
 *   cd backend/bff
 *   bun run backfill:tenant-ids -- --dry-run   (cuenta por regla, no escribe)
 *   bun run backfill:tenant-ids                (aplica)
 *
 * Idempotente: sólo selecciona y actualiza filas con tenantId NULL. Lo
 * ambiguo (varios tenants candidatos) o sin pistas queda NULL y se reporta.
 * Procesa por lotes con cursor por id. Sale con código 0 (2 si los argumentos
 * son inválidos).
 */
import { PrismaClient } from '@prisma/client';
import {
  BATCH_SIZE,
  NOTIFICATION_RULES,
  OUTBOX_RULES,
  USAGE,
  collectNotificationKeys,
  collectOutboxKeys,
  deriveNotificationTenant,
  deriveOutboxTenant,
  formatSummary,
  newSummary,
  normEmail,
  parseArgs,
  record,
  type Derivation,
  type Keys,
  type Lookups,
} from './backfill-tenant-ids.lib';

const prisma = new PrismaClient();

function addTo(m: Map<string, Set<string>>, key: string, tenant: string) {
  const s = m.get(key) ?? new Set<string>();
  s.add(tenant);
  m.set(key, s);
}

async function buildLookups(k: Keys): Promise<Lookups> {
  const requestTenant = new Map<string, string>();
  const documentTenant = new Map<string, string>();
  const onboardingTenant = new Map<string, string>();
  const emailTenants = new Map<string, Set<string>>();
  const userTenants = new Map<string, Set<string>>();

  if (k.requestIds.size) {
    const rows = await prisma.signatureRequest.findMany({
      where: { id: { in: [...k.requestIds] } },
      select: { id: true, tenantId: true },
    });
    for (const r of rows) requestTenant.set(r.id, r.tenantId);
  }
  if (k.documentIds.size) {
    const rows = await prisma.document.findMany({
      where: { id: { in: [...k.documentIds] } },
      select: { id: true, tenantId: true },
    });
    for (const r of rows) documentTenant.set(r.id, r.tenantId);
  }
  if (k.onboardingIds.size) {
    const rows = await prisma.onboardingCase.findMany({
      where: { id: { in: [...k.onboardingIds] } },
      select: { id: true, tenantId: true },
    });
    for (const r of rows) onboardingTenant.set(r.id, r.tenantId);
  }
  if (k.emails.size) {
    const emails = [...k.emails];
    // Correos de firmantes (-> tenant de su solicitud) y de membresías.
    const signers = await prisma.signer.findMany({
      where: { OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) },
      select: { email: true, signatureRequest: { select: { tenantId: true } } },
    });
    for (const s of signers) if (s.email) addTo(emailTenants, normEmail(s.email), s.signatureRequest.tenantId);
    // TenantMembership.tenantId es la FK (uuid de Tenant), no el slug del claim.
    // El aislamiento compara contra el slug (`user.tenantId`). Solo membresías activas.
    const members = await prisma.tenantMembership.findMany({
      where: {
        active: true,
        OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
      },
      select: { email: true, tenant: { select: { slug: true } } },
    });
    for (const m of members) if (m.email) addTo(emailTenants, normEmail(m.email), m.tenant.slug);
  }
  if (k.userIds.size) {
    const rows = await prisma.tenantMembership.findMany({
      where: { active: true, userId: { in: [...k.userIds] } },
      select: { userId: true, tenant: { select: { slug: true } } },
    });
    for (const r of rows) addTo(userTenants, r.userId, r.tenant.slug);
  }
  return { requestTenant, documentTenant, onboardingTenant, emailTenants, userTenants };
}

type Updater = (tenantId: string, ids: string[]) => Promise<unknown>;

async function apply(items: { id: string; d: Derivation }[], update: Updater, dryRun: boolean) {
  if (dryRun) return;
  const byTenant = new Map<string, string[]>();
  for (const { id, d } of items) {
    if (!d.tenantId) continue;
    byTenant.set(d.tenantId, [...(byTenant.get(d.tenantId) ?? []), id]);
  }
  for (const [tenantId, ids] of byTenant) await update(tenantId, ids);
}

async function runOutbox(dryRun: boolean) {
  const summary = newSummary();
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.notificationOutbox.findMany({
      where: { tenantId: null },
      select: { id: true, toAddress: true, dedupeKey: true, payload: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    const lk = await buildLookups(collectOutboxKeys(rows));
    const items = rows.map((r) => ({ id: r.id, d: deriveOutboxTenant(r, lk) }));
    for (const it of items) record(summary, it.d);
    await apply(
      items,
      (tenantId, ids) => prisma.notificationOutbox.updateMany({ where: { id: { in: ids }, tenantId: null }, data: { tenantId } }),
      dryRun,
    );
    cursor = rows[rows.length - 1].id;
  }
  return summary;
}

async function runNotifications(dryRun: boolean) {
  const summary = newSummary();
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.userNotification.findMany({
      where: { tenantId: null },
      select: { id: true, userId: true, href: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    const lk = await buildLookups(collectNotificationKeys(rows));
    const items = rows.map((r) => ({ id: r.id, d: deriveNotificationTenant(r, lk) }));
    for (const it of items) record(summary, it.d);
    await apply(
      items,
      (tenantId, ids) => prisma.userNotification.updateMany({ where: { id: { in: ids }, tenantId: null }, data: { tenantId } }),
      dryRun,
    );
    cursor = rows[rows.length - 1].id;
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.errors.length) {
    for (const e of args.errors) console.error(`Error: ${e}`);
    console.error(`\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { dryRun } = args;
  console.log(dryRun ? '[dry-run] No se escribirá nada en la BD.' : 'Aplicando backfill de tenantId...');
  try {
    const outbox = await runOutbox(dryRun);
    const notifs = await runNotifications(dryRun);
    console.log('');
    console.log(formatSummary('NotificationOutbox', outbox, OUTBOX_RULES, dryRun));
    console.log(formatSummary('UserNotification', notifs, NOTIFICATION_RULES, dryRun));
    const pend = outbox.ambiguas + outbox.sinPistas + notifs.ambiguas + notifs.sinPistas;
    console.log(
      `\nResumen: ${pend} fila(s) permanecen con tenantId NULL (ambiguas o sin pistas); asignar a mano si procede.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Error en el backfill:', e);
  process.exitCode = 1;
});
