/**
 * Bootstrap de tenant para despliegues existentes. TenantContextGuard es
 * fail-closed: con la BD sin `TenantMembership` todo usuario recibe 403.
 * Este script crea (idempotente) el Tenant y la membresía del primer usuario.
 *
 *   cd backend/bff
 *   bun run bootstrap:tenant -- --tenant seguridata --user-id roberto --roles admin,sender,platform_admin --name "Roberto Díaz" --dry-run
 *   (sin --dry-run para aplicar; ver --help)
 *
 * Re-ejecutarlo es seguro: hace upsert; no borra nada. Si el Tenant ya existe
 * no cambia su nombre ni su estado `active`; la membresía se actualiza
 * (roles/nombre/correo) y se reactiva.
 */
import { PrismaClient } from '@prisma/client';
import { USAGE, parseBootstrapArgs } from './bootstrap-tenant.lib';

async function main() {
  const parsed = parseBootstrapArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    if (parsed.help) {
      console.log(USAGE);
      return;
    }
    for (const e of parsed.errors) console.error(`Error: ${e}`);
    console.error(`\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const o = parsed.options;
  const prefix = o.dryRun ? '[dry-run] ' : '';
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.tenant.findUnique({ where: { slug: o.tenant } });
    console.log(
      existing
        ? `${prefix}El tenant "${o.tenant}" ya existe (id ${existing.id}); se conserva.`
        : `${prefix}Se creará el tenant "${o.tenant}" (${o.tenantName}).`,
    );
    if (existing && !existing.active) {
      console.warn(`Aviso: el tenant "${o.tenant}" está inactivo; el guard seguirá rechazando a sus usuarios.`);
    }
    const membership = existing
      ? await prisma.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: existing.id, userId: o.userId } },
        })
      : null;
    console.log(
      `${prefix}${membership ? 'Se actualizará' : 'Se creará'} la membresía de "${o.userId}" con roles [${o.roles.join(', ')}].`,
    );
    if (o.dryRun) {
      console.log('[dry-run] No se escribió nada en la BD.');
      return;
    }

    const tenant =
      existing ??
      (await prisma.tenant.upsert({
        where: { slug: o.tenant },
        create: { slug: o.tenant, name: o.tenantName },
        update: {},
      }));
    await prisma.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: o.userId } },
      create: {
        tenantId: tenant.id,
        userId: o.userId,
        name: o.name,
        email: o.email,
        roles: o.roles,
        active: true,
      },
      update: {
        roles: o.roles,
        active: true,
        ...(o.name ? { name: o.name } : {}),
        ...(o.email ? { email: o.email } : {}),
      },
    });
    console.log(`Listo: "${o.userId}" ya es miembro de "${o.tenant}". Recuerda que el token debe traer el claim tenant="${o.tenant}".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error inesperado: ${(e as Error).message}`);
  process.exitCode = 1;
});
