import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { SignatureRequestsService } from '../signature-requests/signature-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantIdResolver } from '../prisma/tenant-id-resolver';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { PageQueryDto, STABLE_ORDER } from '../common/pagination';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: verify }));
const rows = Array.from({ length: 205 }, (_, n) => ({
  id: `request-${String(205 - n).padStart(3, '0')}`, tenantId: 'acme', requestedBy: 'alice', requestedByName: 'Alice',
  documentId: 'doc-1', status: 'EN_FIRMA', order: 'SECUENCIAL', methods: ['ACCEPT'],
  // Equal timestamps force deterministic id desc ordering across page boundaries.
  createdAt: new Date('2026-10-17T00:00:00Z'), expiresAt: null,
  signers: [{ signerId: 'alice', name: 'Alice', status: 'PENDIENTE', delegatedTo: 'delegate', sortOrder: 0 }],
}));
const foreignActor = { ...rows[0], id: 'other-actor', requestedBy: 'bob', signers: [{ ...rows[0].signers[0], signerId: 'bob', delegatedTo: null }] };
const foreignTenant = { ...rows[0], id: 'other-tenant', tenantId: 'elsewhere' };
const all = [...rows, foreignActor, foreignTenant];
const matches = (row: typeof all[number], where: Record<string, unknown>) => {
  const signer = where.signers as { some: { OR: Array<{ signerId?: string; delegatedTo?: string }> } } | undefined;
  return row.tenantId === where.tenantId && (!where.id || row.id === where.id) && (!where.requestedBy || row.requestedBy === where.requestedBy) &&
    (!signer || row.signers.some(person => signer.some.OR.some(branch => branch.signerId === person.signerId || Boolean(branch.delegatedTo && branch.delegatedTo === person.delegatedTo))));
};
const prisma = { signatureRequest: {
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => all.find(row => matches(row, where)) ?? null),
  findMany: vi.fn(async ({ where, orderBy, take, cursor, skip = 0 }: { where: Record<string, unknown>; orderBy: unknown; take: number; cursor?: { id: string }; skip?: number }) => {
    expect(orderBy).toEqual(STABLE_ORDER);
    const filtered = all.filter(row => matches(row, where)).sort((a, b) => b.id.localeCompare(a.id));
    const offset = cursor ? filtered.findIndex(row => row.id === cursor.id) + skip : 0;
    return offset < 0 ? [] : filtered.slice(offset, offset + take);
  }),
} };
// Exercise the actual list/findRequests/finishPage logic; only the database adapter is a fixture.
const requests = Object.assign(Object.create(SignatureRequestsService.prototype) as SignatureRequestsService, { prisma });
const documents = { findManyByIds: vi.fn(async () => new Map([['doc-1', { id: 'doc-1', caseId: 'case-1', filename: 'Gasto.pdf' }]])) };
const cases = { findManyByIds: vi.fn(async () => new Map([['case-1', { id: 'case-1', title: 'Solicitud de gasto' }]])) };
const inbox = new InboxService(requests, documents as never, cases as never);
Reflect.defineMetadata('design:paramtypes', [InboxService, PrismaService, TenantIdResolver], InboxController);
Reflect.defineMetadata('design:paramtypes', [Object, PageQueryDto], InboxController.prototype, 'inboxFor');
Reflect.defineMetadata('design:paramtypes', [Object, PageQueryDto], InboxController.prototype, 'sentFor');
@Module({ controllers: [InboxController], providers: [
  { provide: InboxService, useValue: inbox }, { provide: PrismaService, useValue: prisma }, { provide: TenantIdResolver, useValue: {} },
] })
class InboxPaginationFixture {}

describe('Inbox cursor pagination over HTTP', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    vi.stubEnv('KEYCLOAK_ISSUER', 'https://identity.example.test/realms/prestige');
    app = await NestFactory.create(InboxPaginationFixture, { logger: false });
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(reflector), new TenantContextGuard(reflector, {
      tenantMembership: { findMany: async () => [{ tenant: { id: 'acme-id', slug: 'acme', active: true } }] },
    } as never));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });
  const actor = (name: string) => verify.mockResolvedValue({ payload: { sub: name, preferred_username: name, tenant: 'acme', realm_access: { roles: ['signer'] } } });
  beforeEach(() => { vi.clearAllMocks(); actor('alice'); });
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}/me/${path}`, { headers: { Authorization: 'Bearer fixture', ...headers } });

  it.each(['inbox', 'sent'])('loads all 205 %s entries with stable, nonoverlapping cursors and composed metadata', async path => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await get(`${path}?limit=50${cursor ? `&cursor=${cursor}` : ''}`); expect(response.status).toBe(200);
      const page = await response.json(); expect(page.items.length).toBeLessThanOrEqual(50);
      for (const item of page.items) { ids.push(item.signatureRequestId); expect(item.caseTitle).toBe('Solicitud de gasto'); expect(item.documentTitle).toBe('Gasto.pdf'); }
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(rows.map(row => row.id)); expect(new Set(ids).size).toBe(205);
    expect(documents.findManyByIds).toHaveBeenCalledWith(expect.any(Array), 'acme');
    expect(cases.findManyByIds).toHaveBeenCalledWith(expect.any(Array), 'acme');
  });
  it.each(['inbox', 'sent'])('preserves legacy arrays, enforces JWT scope and validates cursors on %s', async path => {
    const legacy = await get(path); expect(legacy.status).toBe(200); expect(await legacy.json()).toHaveLength(200);
    for (const cursor of ['other-actor', 'other-tenant', 'missing']) expect((await get(`${path}?limit=50&cursor=${cursor}`)).status).toBe(400);
    expect((await get(`${path}?limit=50`, { Authorization: '' })).status).toBe(401);
    expect((await get(`${path}?limit=50`, { 'X-Tenant-Id': 'elsewhere' })).status).toBe(403);
    expect((await get(`${path}?limit=201`)).status).toBe(400);
    expect((await get(`${path}?limit=50&signerId=bob`)).status).toBe(400);
  });
  it('preserves delegated signer membership and turn semantics while paging', async () => {
    actor('delegate');
    const first = await (await get('inbox?limit=1')).json();
    expect(first.items[0]).toMatchObject({ signatureRequestId: rows[0].id, myTurn: true, currentSignerId: 'alice' });
    expect((await get(`inbox?limit=1&cursor=${first.nextCursor}`)).status).toBe(200);
    const sent = await (await get('sent?limit=50')).json(); expect(sent.items).toEqual([]); expect(sent.nextCursor).toBeNull();
  });
});
