/**
 * Reduce el catálogo del sandbox a Gastos/Adquisiciones y sus subprocesos.
 * Conserva TODAS las definiciones, solicitudes, documentos, ejecuciones y auditorías.
 *
 * node --env-file=.env --import tsx scripts/prune-process-catalog.ts --tenant=seguridata
 * Para aplicar: añadir --apply --sandbox --confirm-tenant=seguridata
 */
import { PrismaClient } from '@prisma/client';
import { tenantGuardExtension } from '../src/prisma/tenant-guard';

const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const tenantId = option('tenant');
if (!tenantId || tenantId === 'platform' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(tenantId)) {
  throw new Error('Indica --tenant=<slug del sandbox>; platform no es un tenant de trabajo.');
}
const apply = args.includes('--apply');
const connection = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
if (apply && (!args.includes('--sandbox') || option('confirm-tenant') !== tenantId ||
  process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(connection.hostname) ||
  !/^\/prestige(?:_sandbox)?$/.test(connection.pathname))) {
  throw new Error('Aplicación permitida solo con --sandbox --confirm-tenant=<slug>, DB local prestige y fuera de producción.');
}

const allowedKeys = new Set(['adquisiciones-gastos', 'renovacion-licenciamiento', 'proveedores-estrategicos', 'subproceso-gestion-de-proveedores-estrategicos', 'flujo-de-adquisicion']);
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function belongsToAcquisitions(key: string, name: string) {
  return allowedKeys.has(key) || /(?:\badquisicion(?:es)?\b|\bgastos\b)/.test(normalize(name));
}

const prisma = new PrismaClient().$extends(tenantGuardExtension());
async function main(tenantId: string) {
try {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantId }, select: { slug: true, active: true } });
  if (!tenant?.active) throw new Error('El tenant no existe o está inactivo.');
  const definitions = await prisma.processDefinition.findMany({
    where: { OR: [{ tenantId }, { tenantId: 'platform' }] }, orderBy: [{ key: 'asc' }, { version: 'desc' }],
    select: { key: true, name: true, version: true, tenantId: true },
  });
  const keys = [...new Set(definitions.map((row) => row.key))];
  const plan = keys.map((key) => {
    const all = definitions.filter((row) => row.key === key);
    const own = all.filter((row) => row.tenantId === tenantId);
    const effective = own.length ? own : all;
    const latest = effective[0];
    return { key, name: latest.name, versions: effective.length, owner: latest.tenantId,
      action: belongsToAcquisitions(key, latest.name) ? 'keep' as const : 'archive' as const };
  });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', tenantId, plan }, null, 2));
  if (apply) {
    // Reversible, acotado al tenant. Las semillas compartidas se ocultan por preferencia;
    // jamás se despublican globalmente ni se borran filas históricas.
    await prisma.$transaction(async (tx) => {
      for (const entry of plan) {
        const archivedAt = entry.action === 'archive' ? new Date() : null;
        await tx.processCatalogPreference.upsert({
          where: { tenantId_key: { tenantId, key: entry.key } },
          create: { tenantId, key: entry.key, archivedAt }, update: { archivedAt },
        });
        if (archivedAt) await tx.processDefinition.updateMany({
          where: { tenantId, key: entry.key }, data: { published: false, publishedAt: null },
        });
      }
    });
    console.log(JSON.stringify({ applied: true, kept: plan.filter((entry) => entry.action === 'keep').length,
      archived: plan.filter((entry) => entry.action === 'archive').length, preservedHistoricalData: true }));
  }
} finally {
  await prisma.$disconnect();
}
}
main(tenantId).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
