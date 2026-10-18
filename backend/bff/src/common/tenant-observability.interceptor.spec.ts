import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
const telemetry = vi.hoisted(() => ({ add: vi.fn(), record: vi.fn(), setAttributes: vi.fn() }));
vi.mock('@opentelemetry/api', () => ({
  metrics: { getMeter: () => ({ createCounter: () => ({ add: telemetry.add }), createHistogram: () => ({ record: telemetry.record }) }) },
  trace: { getActiveSpan: () => ({ setAttributes: telemetry.setAttributes }) },
}));
import { TenantObservabilityInterceptor } from './tenant-observability.interceptor';
const ctx = (tenantId?: string) => ({ switchToHttp: () => ({
  getRequest: () => ({ user: tenantId ? { tenantId } : undefined, method: 'GET', route: { path: '/cases/:id' }, url: '/cases/secret-personal-id' }),
  getResponse: () => ({ statusCode: 200 }),
}), getHandler: () => function getCase() {} }) as unknown as ExecutionContext;
describe('observabilidad por tenant', () => {
  it('etiqueta solo tenant autenticado y ruta normalizada, sin IDs personales', async () => {
    vi.clearAllMocks();
    await lastValueFrom(new TenantObservabilityInterceptor().intercept(ctx('acme'), { handle: () => of('ok') }));
    expect(telemetry.setAttributes).toHaveBeenCalledWith({ 'tenant.id': 'acme', 'http.request.method': 'GET', 'http.route': '/cases/:id' });
    expect(telemetry.add).toHaveBeenCalledWith(1, expect.objectContaining({ 'http.response.status_code': 200 }));
    expect(telemetry.record).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ 'tenant.id': 'acme' }));
  });
  it('registra error HTTP real antes del filtro de excepciones y omite peticiones sin tenant', async () => {
    vi.clearAllMocks();
    await expect(lastValueFrom(new TenantObservabilityInterceptor().intercept(ctx('acme'), { handle: () => throwError(() => new ForbiddenException()) }))).rejects.toThrow();
    expect(telemetry.add).toHaveBeenCalledWith(1, expect.objectContaining({ 'http.response.status_code': 403 }));
    vi.clearAllMocks();
    await lastValueFrom(new TenantObservabilityInterceptor().intercept(ctx(), { handle: () => of('ok') }));
    expect(telemetry.add).not.toHaveBeenCalled();
  });
});
