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

  it('escrituras masivas y altas exigen tenant; por id o unique no', () => {
    expect(tenantViolation('HumanTask', 'updateMany', { where: { signerId: 'x' }, data: {} })).toMatch(/where/);
    expect(tenantViolation('HumanTask', 'updateMany', { where: { id: 't1' }, data: {} })).toBeNull();
    expect(tenantViolation('HumanTask', 'deleteMany', { where: { tenantId: 'a' } })).toBeNull();
    expect(tenantViolation('Document', 'create', { data: { filename: 'x' } })).toMatch(/datos/);
    expect(tenantViolation('Document', 'create', { data: { tenantId: 'a' } })).toBeNull();
    expect(tenantViolation('Document', 'createMany', { data: [{ tenantId: 'a' }, { filename: 'x' }] })).toMatch(
      /datos/,
    );
    expect(tenantViolation('OutOfOffice', 'upsert', { where: {}, create: { userId: 'u' }, update: {} })).toMatch(
      /datos/,
    );
    expect(tenantViolation('Document', 'findUnique', { where: { id: 'd' } })).toBeNull();
    expect(tenantViolation('AuditAnchor', 'findMany', {})).toBeNull();
  });

  it('las excepciones de sistema y runAsSystem no se rechazan', async () => {
    expect(() =>
      checkTenantScope('NotificationOutbox', 'findMany', { where: { status: 'PENDIENTE' } }, enforce),
    ).not.toThrow();
    expect(() => checkTenantScope('HumanTask', 'findMany', {}, enforce)).toThrow();
    await runAsSystem('prueba', async () => {
      expect(() => checkTenantScope('HumanTask', 'findMany', {}, enforce)).not.toThrow();
    });
    expect(() => runAsSystem(' ', async () => undefined)).toThrow();
  });

  it('en modo log no lanza y avisa; en off ni evalúa', () => {
    const onViolation = vi.fn();
    expect(() => checkTenantScope('Document', 'findMany', {}, { mode: () => 'log', onViolation })).not.toThrow();
    expect(onViolation).toHaveBeenCalledOnce();
    checkTenantScope('Document', 'findMany', {}, { mode: () => 'off', onViolation });
    expect(onViolation).toHaveBeenCalledOnce();
  });

  it('modo por defecto: enforce en test, log fuera; TENANT_GUARD manda', () => {
    expect(resolveGuardMode({ NODE_ENV: 'test' })).toBe('enforce');
    expect(resolveGuardMode({ NODE_ENV: 'production' })).toBe('log');
    expect(resolveGuardMode({ NODE_ENV: 'production', TENANT_GUARD: 'enforce' })).toBe('enforce');
    expect(resolveGuardMode({ NODE_ENV: 'test', TENANT_GUARD: 'off' })).toBe('off');
  });
});
