/**
 * Carga, por tenant y de forma idempotente, el ejemplo completo de «Solicitud de gastos / Adquisiciones»:
 *   (a) tabla de consulta `roles-adquisiciones` con el Ejecutivo de Administración y Tesorería (EJEMPLO EDITABLE),
 *   (b) verifica `responsables-gasto` (si falta la crea vacía e informa que hay que importar la matriz),
 *   (c) formato digital «Solicitud de gastos (Adquisiciones)» con sus variables, flujo y anexos, ya PUBLICADO.
 *
 * Usa los servicios reales de Nest (mismas validaciones, auditoría y cifrado que la API), con un módulo MÍNIMO: no carga
 * `AppModule`, así que NO arrancan los trabajos programados (outbox de notificaciones, webhooks, conciliadores).
 *
 *   cd backend/bff
 *   bun run seed:example-gastos -- --dry-run                 (solo informa)
 *   bun run seed:example-gastos                              (tenant seguridata)
 *   bun run seed:example-gastos -- --tenant acme --force     (regenera el formato si cambió el flujo)
 *
 * Necesita el mismo entorno que el BFF (DATABASE_URL, claves de almacenamiento/cifrado, REDIS_URL…). Corre sobre el JS
 * compilado por `tsc` (los servicios de Nest necesitan `emitDecoratorMetadata`, que bun/tsx no emiten); la compilación
 * va a node_modules/.cache y no toca `dist/` (que puede estar en uso por `nest start --watch`).
 * Códigos de salida: 0 todo en orden · 1 error · 2 argumentos · 3 hay pendientes (p. ej. falta importar la matriz).
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { RedisModule } from '../../src/redis/redis.module';
import { StorageModule } from '../../src/storage/storage.module';
import { CollaborationModule } from '../../src/collaboration/collaboration.module';
import { AuthModule } from '../../src/auth/auth.module';
import { DocumentTemplatesModule } from '../../src/document-templates/document-templates.module';
import { DocumentTemplatesService } from '../../src/document-templates/document-templates.service';
import { LookupTablesService } from '../../src/lookup-tables/lookup-tables.service';
import { USAGE, formatReport, parseSeedArgs, runSeed } from './seed-example-gastos.lib';

/** Sin `ScheduleModule`: los `@Interval` de los servicios no se registran. */
@Module({
  imports: [PrismaModule, RedisModule, StorageModule, CollaborationModule, AuthModule, DocumentTemplatesModule],
  providers: [LookupTablesService],
})
export class SeedExampleModule {}

async function main(): Promise<number> {
  const parsed = parseSeedArgs(process.argv.slice(2), process.env);
  if (!parsed.ok) {
    if (parsed.help) {
      console.log(USAGE);
      return 0;
    }
    for (const e of parsed.errors) console.error(`Error: ${e}`);
    console.error(`\n${USAGE}`);
    return 2;
  }
  const options = parsed.options;

  const app = await NestFactory.createApplicationContext(SeedExampleModule, { logger: ['error', 'warn'] });
  try {
    const report = await runSeed(
      { tables: app.get(LookupTablesService, { strict: false }), templates: app.get(DocumentTemplatesService, { strict: false }) },
      options,
    );
    console.log(formatReport(report, options));
    return report.exitCode;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`Error inesperado: ${(e as Error).message}`);
    process.exit(1);
  });
