import { describe, expect, it, vi } from 'vitest';
import {
  TenantGuardError,
  checkTenantScope,
  resolveGuardMode,
  runAsSystem,
  tenantModels,
  tenantViolation,
  whereHasTenant,
} from './tenant-guard';

const enforce = { mode: () => 'enforce' as const };

describe('tenant-guard', () => {
  it('detecta los modelos con tenantId desde el esquema', () => {
    const m = tenantModels();
    expect(m.has('OutOfOffice')).toBe(true);
    expect(m.has('ProcessAuditEvent')).toBe(true);
    expect(m.has('AuditAnchor')).toBe(false);
  });

  it('rechaza lecturas masivas sin tenantId', () => {
    expect(() => checkTenantScope('HumanTask', 'findMany', { where: { signerId: 'x' } }, enforce)).toThrow(
      TenantGuardError,
    );
    expect(() => checkTenantScope('Document', 'count', undefined, enforce)).toThrow(TenantGuardError);
  });

  it('tenantId: undefined no cuenta como filtro (valor perdido)', () => {
    expect(() => checkTenantScope('Document', 'findMany', { where: { tenantId: undefined } }, enforce)).toThrow(
      TenantGuardError,
    );
  });

  it('acepta tenantId directo, en AND, en todas las ramas de un OR y unique compuesta', () => {
    expect(whereHasTenant({ tenantId: 'a' })).toBe(true);
    expect(whereHasTenant({ AND: [{ x: 1 }, { tenantId: 'a' }] })).toBe(true);
    expect(whereHasTenant({ OR: [{ tenantId: 'a' }, { tenantId: 'b' }] })).toBe(true);
    expect(whereHasTenant({ tenantId_userId: { tenantId: 'a', userId: 'u' } })).toBe(true);
    // una rama del OR sin tenant deja pasar otras filas
    expect(whereHasTenant({ OR: [{ tenantId: 'a' }, { signerId: 'u' }] })).toBe(false);
    expect(whereHasTenant({ OR: [] })).toBe(false);
  });

  it('escrituras masivas, claves únicas y altas exigen tenant', () => {
    expect(tenantViolation('HumanTask', 'updateMany', { where: { signerId: 'x' }, data: {} })).toMatch(/where/);
    expect(tenantViolation('HumanTask', 'updateMany', { where: { id: 't1' }, data: {} })).toMatch(/where/);
    expect(tenantViolation('HumanTask', 'deleteMany', { where: { tenantId: 'a' } })).toBeNull();
    expect(tenantViolation('Document', 'create', { data: { filename: 'x' } })).toMatch(/datos/);
    expect(tenantViolation('Document', 'create', { data: { tenantId: 'a' } })).toBeNull();
    expect(tenantViolation('Document', 'createMany', { data: [{ tenantId: 'a' }, { filename: 'x' }] })).toMatch(
      /datos/,
    );
    expect(tenantViolation('OutOfOffice', 'upsert', { where: { tenantId_userId: { tenantId: 'a', userId: 'u' } }, create: { userId: 'u' }, update: {} })).toMatch(
      /datos/,
    );
    expect(tenantViolation('Document', 'findUnique', { where: { id: 'd' } })).toMatch(/where/);
    expect(tenantViolation('AuditAnchor', 'findMany', {})).toBeNull();
  });

  it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert', 'updateMany', 'deleteMany'])(
    '%s no acepta una clave como sustituto de tenant', (operation) => {
      const args = { where: { id: 'victim' }, create: { tenantId: 'a' }, data: {}, update: {} };
      expect(() => checkTenantScope('Document', operation, args, enforce)).toThrow(TenantGuardError);
      expect(() => checkTenantScope('Document', operation, { ...args, where: { id: 'victim', tenantId: 'a' } }, enforce)).not.toThrow();
    },
  );

  it.each([undefined, null, '', '  ', {}, { not: 'b' }, { in: ['a', 'b'] }, { equals: undefined }, { equals: 'a', mode: 'insensitive' }])(
    'rechaza filtros de tenant sin igualdad concreta: %j', (tenantId) => {
      expect(whereHasTenant({ tenantId })).toBe(false);
      expect(whereHasTenant({ tenantId_userId: { tenantId, userId: 'u' } })).toBe(false);
    },
  );

  it('la igualdad explícita acota; un nombre de clave compuesta sin tenant interior no', () => {
    expect(whereHasTenant({ tenantId: { equals: 'a' } })).toBe(true);
    expect(whereHasTenant({ tenantId_userId: 'a' })).toBe(false);
    expect(whereHasTenant({ tenantId_userId: {} })).toBe(false);
    expect(whereHasTenant({ NOT: { tenantId: 'a' } })).toBe(false);
    expect(whereHasTenant({ AND: [{ OR: [{ tenantId: 'a' }, { userId: 'x' }] }] })).toBe(false);
  });

  it('una escritura no cambia de tenant y upsert conserva el tenant de búsqueda al crear', () => {
    for (const operation of ['update', 'updateMany', 'updateManyAndReturn']) {
      expect(tenantViolation('Document', operation, { where: { id: 'd', tenantId: 'a' }, data: { tenantId: 'b' } })).toMatch(/cambiar/);
      expect(tenantViolation('Document', operation, { where: { id: 'd', tenantId: 'a' }, data: { tenantId: { set: 'b' } } })).toMatch(/cambiar/);
      expect(tenantViolation('Document', operation, { where: { id: 'd', tenantId: 'a' }, data: { tenantId: 'a' } })).toBeNull();
    }
    expect(tenantViolation('Document', 'upsert', { where: { id: 'd', tenantId: 'a' }, create: { tenantId: 'b' }, update: {} })).toMatch(/coincide/);
    expect(tenantViolation('Document', 'upsert', { where: { id: 'd', tenantId: 'a' }, create: { tenantId: 'a' }, update: { tenantId: 'b' } })).toMatch(/cambiar/);
    expect(tenantViolation('OutOfOffice', 'upsert', { where: { tenantId_userId: { tenantId: 'a', userId: 'u' } }, create: { tenantId: 'a' }, update: {} })).toBeNull();
  });

  it('solo runAsSystem permite consultas globales y no deja escapar su contexto', async () => {
    expect(() =>
      checkTenantScope('NotificationOutbox', 'findMany', { where: { status: 'PENDIENTE' } }, enforce),
    ).toThrow(TenantGuardError);
    expect(() => checkTenantScope('WorkflowRun', 'findMany', {}, enforce)).toThrow(TenantGuardError);
    expect(() => checkTenantScope('NotificationOutbox', 'updateMany', {}, enforce)).toThrow(TenantGuardError);
    expect(() => checkTenantScope('HumanTask', 'findMany', {}, enforce)).toThrow();
    await runAsSystem('prueba', async () => {
      expect(() => checkTenantScope('HumanTask', 'findMany', {}, enforce)).not.toThrow();
    });
    expect(() => checkTenantScope('HumanTask', 'findMany', {}, enforce)).toThrow(TenantGuardError);
    expect(() => runAsSystem(' ', async () => undefined)).toThrow();
  });

  it('en modo log no lanza y avisa; en off ni evalúa', () => {
    const onViolation = vi.fn();
    expect(() => checkTenantScope('Document', 'findMany', {}, { mode: () => 'log', onViolation })).not.toThrow();
    expect(onViolation).toHaveBeenCalledOnce();
    checkTenantScope('Document', 'findMany', {}, { mode: () => 'off', onViolation });
    expect(onViolation).toHaveBeenCalledOnce();
  });

  it('modo por defecto: enforce en test y desarrollo, log solo en producción; TENANT_GUARD manda', () => {
    expect(resolveGuardMode({ NODE_ENV: 'test' })).toBe('enforce');
    expect(resolveGuardMode({ NODE_ENV: 'development' })).toBe('enforce');
    expect(resolveGuardMode({})).toBe('enforce');
    expect(resolveGuardMode({ NODE_ENV: 'production' })).toBe('log');
    expect(resolveGuardMode({ NODE_ENV: 'production', TENANT_GUARD: 'enforce' })).toBe('enforce');
    expect(resolveGuardMode({ NODE_ENV: 'test', TENANT_GUARD: 'off' })).toBe('off');
  });
});
