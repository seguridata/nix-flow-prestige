import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';
import { AuditChainService } from '../collaboration/audit-chain.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: verify }));

const published = {
  id: 'definition-1', tenantId: 'acme', key: 'gastos', name: 'Gastos', description: 'Solicitud de gastos',
  version: 2, published: true, publishedAt: '2026-10-17T01:00:00Z', updatedAt: '2026-10-17T01:00:00Z',
  bpmnXml: '<bpmn>ADMINISTRATIVE_BPMN</bpmn>', dmnXml: '<dmn>ADMINISTRATIVE_DMN</dmn>', decisionRules: [{ internal: 'ADMINISTRATIVE_DECISIONS' }],
  flow: {
    order: 'SECUENCIAL', slaHours: 24,
    variables: [{ key: 'monto', type: 'number', label: 'Monto', required: true }],
    derived: [{ key: 'responsable', label: 'Responsable', type: 'text', column: 'PRIVATE_COLUMN', onMiss: 'fail', query: { table: 'PRIVATE_DERIVED_TABLE', where: [] } }],
    steps: [
      { id: 'solicitante', label: 'Solicitante', role: 'FIRMANTE', who: { type: 'initiator' } },
      { id: 'autorizar', label: 'Autorizar', role: 'REVISOR', who: { type: 'lookup', prompt: 'Selecciona a quien autoriza', query: { table: 'PRIVATE_STEP_TABLE', where: [{ column: 'PRIVATE_FILTER', op: '=', source: { var: 'monto' } }] }, person: { signerId: 'PRIVATE_PERSON_COLUMN', email: 'PRIVATE_EMAIL_COLUMN' } } },
    ],
  },
};
const draft = { ...published, id: 'draft-3', version: 3, published: false };
const service = {
  listPublished: vi.fn(async () => [published]), list: vi.fn(async () => [published, draft]),
  catalog: vi.fn(async () => [draft]), versions: vi.fn(async () => [draft, published]),
  getVersion: vi.fn(async () => draft), getLatest: vi.fn(async () => draft),
};
// Vitest/esbuild omits the design metadata tsc emits for the real Nest application.
Reflect.defineMetadata('design:paramtypes', [ProcessService, AuditChainService], ProcessController);
@Module({ controllers: [ProcessController], providers: [
  { provide: ProcessService, useValue: service }, { provide: AuditChainService, useValue: {} },
] })
class ProcessAuthorizationFixture {}

describe('Process configuration authorization and sender response over HTTP', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    vi.stubEnv('KEYCLOAK_ISSUER', 'https://identity.example.test/realms/prestige');
    app = await NestFactory.create(ProcessAuthorizationFixture, { logger: false });
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(reflector), new TenantContextGuard(reflector, {
      tenantMembership: { findMany: async () => [{ tenant: { id: 'acme-uuid', slug: 'acme', active: true } }] },
    } as never), new RolesGuard(reflector));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });
  const role = (name: string) => verify.mockResolvedValue({ payload: { sub: 'user-sub', preferred_username: 'ana', tenant: 'acme', realm_access: { roles: [name] } } });
  beforeEach(() => { vi.clearAllMocks(); role('admin'); });
  const request = (path: string, headers: Record<string, string> = {}) => fetch(`${base}/${path}`, { headers: { Authorization: 'Bearer fixture-token', ...headers } });
  const adminPaths = [
    'process-catalog', 'process-definitions/gastos', 'process-definitions/gastos/versions',
    'process-definitions/gastos/versions/3', 'process-definitions/gastos/bpmn', 'process-definitions/gastos/dmn',
  ];

  it.each(adminPaths)('requires an authenticated administrator for %s', async path => {
    expect((await request(path, { Authorization: '' })).status).toBe(401);
    for (const name of ['sender', 'signer', 'platform_admin']) {
      role(name); expect((await request(path)).status).toBe(403);
    }
    expect(service.catalog).not.toHaveBeenCalled(); expect(service.getLatest).not.toHaveBeenCalled();
    expect(service.versions).not.toHaveBeenCalled(); expect(service.getVersion).not.toHaveBeenCalled();
  });

  it.each(adminPaths)('lets an administrator read configuration at %s', async path => {
    const response = await request(path); expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('ADMINISTRATIVE');
  });

  it.each(['sender', 'signer'])('sanitizes published selection and ignores draft requests for %s', async name => {
    role(name);
    const response = await request('process-definitions?published=false'); expect(response.status).toBe(200);
    const result = await response.json(); expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'definition-1', version: 2, published: true, flow: { order: 'SECUENCIAL', slaHours: 24 } });
    expect(result[0].flow.steps[1].who).toEqual({ type: 'lookup', prompt: 'Selecciona a quien autoriza' });
    expect(result[0].flow.derived).toEqual([{ key: 'responsable', label: 'Responsable', type: 'text' }]);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/PRIVATE_|ADMINISTRATIVE|bpmnXml|dmnXml|decisionRules|tenantId|draft-3/);
    expect(service.listPublished).toHaveBeenCalledWith('acme'); expect(service.list).not.toHaveBeenCalled();
    // Sanitization must never mutate the cached administrative definition.
    expect(published.flow.steps[1].who).toHaveProperty('query.table', 'PRIVATE_STEP_TABLE');
  });

  it('keeps admin selection complete and scoped to the authenticated tenant', async () => {
    const response = await request('process-definitions?published=true'); expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('PRIVATE_STEP_TABLE');
    expect(service.listPublished).toHaveBeenCalledWith('acme');
    expect((await request('process-catalog', { 'X-Tenant-Id': 'foreign-tenant' })).status).toBe(403);
    expect(service.catalog).not.toHaveBeenCalled();
  });

  it('never makes the published selector anonymous', async () => {
    expect((await request('process-definitions?published=true', { Authorization: '' })).status).toBe(401);
    expect(service.listPublished).not.toHaveBeenCalled();
  });
});
