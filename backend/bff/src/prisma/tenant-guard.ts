/**
 * ADR-004 (defensa en profundidad): extensión de Prisma que exige `tenantId` en las
 * consultas de modelos con tenant.
 *
 * Qué valida (`assertTenantScoped`):
 *  - Lecturas y escrituras MASIVAS (`findMany`, `findFirst*`, `count`, `aggregate`,
 *    `groupBy`, `updateMany`, `deleteMany`): el `where` debe fijar `tenantId`
 *    (directo, dentro de `AND`, o en TODAS las ramas de un `OR`, o con una unique
 *    compuesta `tenantId_*`). `tenantId: undefined` NO cuenta (es el bug típico: el
 *    valor se perdió y Prisma omite el filtro).
 *  - Altas (`create`, `createMany*`, `upsert`): el dato debe traer `tenantId`.
 *
 * Las operaciones por clave única (`findUnique*`, `update`, `delete`, `upsert`)
 * también exigen tenant en el `where`. Un `id` no sustituye al tenant, incluso
 * después de haber cargado la fila. La guarda comprueba el filtro; el llamador
 * debe obtener el tenant del actor autorizado, no del cuerpo de la petición.
 *
 * Excepciones: solo `runAsSystem(razon, fn)` junto a una consulta de sistema.
 * No hay exenciones globales por modelo/operación: otro llamador debe fijar tenant.
 *
 * Modo (`TENANT_GUARD`): `enforce` lanza `TenantGuardError`; `log` registra una vez por
 * (modelo, operación) y deja pasar; `off` desactiva. Por defecto: `enforce` en tests y en
 * desarrollo, `log` solo en producción (hasta validar staging; ahí basta TENANT_GUARD=enforce).
 *
 * Cómo activarlo en un entorno (dev/stage/prod): definir `TENANT_GUARD=enforce` en el
 * entorno del BFF y reiniciarlo (el modo se lee en cada consulta, pero la variable de
 * proceso solo cambia al reiniciar). No hay cambio de código. Para volver atrás:
 * `TENANT_GUARD=log` (o `off`). Con `enforce`, una consulta sin `tenantId` responde 500 y
 * deja `TenantGuardError: TenantGuard: Modelo.operación …` en el log; con `log` el mismo
 * caso aparece una vez como «Rechazada en modo enforce». Estado: ver §2 de
 * MasterPlan/ARQUITECTURA-MULTITENANT-Y-ESCALA.md. Regresiones: `tenant-guard.sweep.spec.ts`
 * (barrido estático) y `tenant-guard.enforce.spec.ts` (servicios con el cliente real).
 *
 * Resolución slug/uuid: `TenantMembership.tenantId` y `Policy.tenantId` guardan el UUID del
 * `Tenant`; el resto de modelos, el slug. Para filtrar esas dos tablas usar
 * `TenantIdResolver.toId(slug)` (src/prisma/tenant-id-resolver.ts) y filtrar por la columna,
 * nunca por la relación `tenant: { OR: [...] }` (no fija `tenantId` y la guarda la rechaza).
 *
 * RLS (`SET LOCAL app.tenant` + políticas por tabla) NO se implementa aquí: exige que
 * TODA consulta corra dentro de una transacción con el contexto fijado (el pool de
 * Prisma no garantiza la misma conexión entre llamadas), y los ticks y el worker
 * necesitan un rol que la omita. Hacerlo ahora rompería las consultas existentes; queda
 * como siguiente paso, y esta extensión es la red mientras tanto.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type TenantGuardMode = 'enforce' | 'log' | 'off';

export class TenantGuardError extends Error {
  constructor(
    readonly model: string,
    readonly operation: string,
    detail: string,
  ) {
    super(`TenantGuard: ${model}.${operation} ${detail}`);
    this.name = 'TenantGuardError';
  }
}

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
  'upsert',
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

const systemContext = new AsyncLocalStorage<string>();

/**
 * Ejecuta `fn` sin la guarda. `reason` es obligatoria y queda en el log de depuración.
 *
 * Ojo: las consultas de Prisma son PEREZOSAS (se ejecutan al hacer `await`/`.then`, no
 * al llamarlas). Si `fn` devolviera la consulta sin esperarla, se ejecutaría FUERA del
 * contexto de sistema y la guarda la rechazaría. Por eso se espera dentro del contexto.
 */
export function runAsSystem<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  if (!reason.trim()) throw new Error('runAsSystem exige una razón');
  return systemContext.run(reason, async () => await fn());
}

let tenantModelsCache: ReadonlySet<string> | undefined;
/** Modelos (nombre del DMMF, p. ej. `OutOfOffice`) que tienen una columna `tenantId`. */
export function tenantModels(): ReadonlySet<string> {
  tenantModelsCache ??= new Set(
    Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
      .map((m) => m.name),
  );
  return tenantModelsCache;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const tenantValue = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
const tenantEquality = (v: unknown): boolean => tenantValue(v) ||
  (isObj(v) && tenantValue(v.equals) && v.mode !== 'insensitive');

/** ¿El `where` fija el tenant en todos los caminos posibles? */
export function whereHasTenant(where: unknown): boolean {
  if (!isObj(where)) return false;
  if (tenantEquality(where.tenantId)) return true;
  if (Object.entries(where).some(([key, value]) => key.split('_').includes('tenantId') &&
    isObj(value) && tenantValue(value.tenantId))) return true;
  const and = where.AND;
  if (Array.isArray(and) ? and.some(whereHasTenant) : whereHasTenant(and)) return true;
  const or = where.OR;
  return Array.isArray(or) && or.length > 0 && or.every(whereHasTenant);
}

const dataHasTenant = (data: unknown): boolean =>
  Array.isArray(data) ? data.length > 0 && data.every(dataHasTenant) : isObj(data) && tenantValue(data.tenantId);

/** Comprueba que todas las filas seleccionables pertenecen al tenant de una escritura. */
function whereSelectsTenant(where: unknown, tenantId: string): boolean {
  if (!isObj(where)) return false;
  if (where.tenantId === tenantId || (isObj(where.tenantId) && where.tenantId.equals === tenantId &&
    where.tenantId.mode !== 'insensitive')) return true;
  if (Object.entries(where).some(([key, value]) => key.split('_').includes('tenantId') &&
    isObj(value) && value.tenantId === tenantId)) return true;
  const and = where.AND;
  if (Array.isArray(and) ? and.some(w => whereSelectsTenant(w, tenantId)) : whereSelectsTenant(and, tenantId)) return true;
  return Array.isArray(where.OR) && where.OR.length > 0 && where.OR.every(w => whereSelectsTenant(w, tenantId));
}

/** Devuelve el motivo de rechazo, o `null` si la consulta está acotada (o no aplica). */
export function tenantViolation(model: string, operation: string, args: unknown): string | null {
  if (!tenantModels().has(model)) return null;
  const a = isObj(args) ? args : {};
  if (WHERE_OPS.has(operation)) {
    if (!whereHasTenant(a.where)) return 'sin igualdad concreta de tenantId en el where';
  }
  if (CREATE_OPS.has(operation)) {
    const data = operation === 'upsert' ? a.create : a.data;
    if (!dataHasTenant(data)) return 'sin tenantId en los datos';
    if (operation === 'upsert' && !whereSelectsTenant(a.where, (data as Json).tenantId as string)) {
      return 'tenantId de create no coincide con el where de upsert';
    }
  }
  if (['update', 'updateMany', 'updateManyAndReturn', 'upsert'].includes(operation)) {
    const data = operation === 'upsert' ? a.update : a.data;
    if (isObj(data) && Object.prototype.hasOwnProperty.call(data, 'tenantId')) {
      const nextTenant = isObj(data.tenantId) ? data.tenantId.set : data.tenantId;
      if (!tenantValue(nextTenant) || !whereSelectsTenant(a.where, nextTenant as string)) {
        return 'no se permite cambiar el tenantId de una fila';
      }
    }
  }
  return null;
}

export function resolveGuardMode(env: NodeJS.ProcessEnv = process.env): TenantGuardMode {
  const v = env.TENANT_GUARD?.toLowerCase();
  if (v === 'enforce' || v === 'log' || v === 'off') return v;
  // Falla cerrado donde se desarrolla y se prueba (una consulta nueva sin tenant no llega a producción); en producción
  // queda en `log` hasta validar un entorno de staging con TENANT_GUARD=enforce (validado en desarrollo el 2026-10-16:
  // 0 rechazos ni errores 5xx en la batería de punta a punta, y el barrido estático corre como prueba de regresión).
  return env.NODE_ENV === 'production' && !env.VITEST ? 'log' : 'enforce';
}

export interface TenantGuardOptions {
  /** Se evalúa en cada consulta (permite cambiarlo por variable sin reconstruir). */
  mode?: () => TenantGuardMode;
  onViolation?: (v: { model: string; operation: string; detail: string }) => void;
}

const log = new Logger('TenantGuard');

/** Aplica la guarda; lanza en `enforce`, registra en `log`. Exportada para pruebas. */
export function checkTenantScope(model: string, operation: string, args: unknown, opts: TenantGuardOptions = {}) {
  const mode = (opts.mode ?? resolveGuardMode)();
  if (mode === 'off' || systemContext.getStore()) return;
  const detail = tenantViolation(model, operation, args);
  if (!detail) return;
  opts.onViolation?.({ model, operation, detail });
  if (mode === 'enforce') throw new TenantGuardError(model, operation, detail);
  const key = `${model}.${operation}`;
  if (!warned.has(key)) {
    warned.add(key);
    log.error(`${key} ${detail}. Rechazada en modo enforce; revisar el punto de llamada.`);
  }
}
const warned = new Set<string>();

/** Extensión para `client.$extends(...)`: corre la guarda antes de cada consulta. */
export function tenantGuardExtension(opts: TenantGuardOptions = {}) {
  return Prisma.defineExtension({
    name: 'tenant-guard',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          checkTenantScope(model, operation, args, opts);
          return query(args);
        },
      },
    },
  });
}
