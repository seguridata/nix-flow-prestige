import 'reflect-metadata';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './mcp-auth.guard';
import { validateMcpClaims } from './mcp-auth.guard';
import { mcpConfig } from './mcp.config';
import { PrismaService } from '../prisma/prisma.service';

const prisma = {
  tenantMembership: { findMany: vi.fn(async () => [{ roles: ['sender'], tenant: { active: true, slug: 'seguridata', id: 'tenant-uuid' } }]) },
  signatureRequest: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  processDefinition: { findMany: vi.fn(async () => []) },
  humanTask: { findMany: vi.fn(async () => []) },
  documentTemplate: { findMany: vi.fn(async () => []) },
};
// esbuild does not emit the metadata that tsc emits in the running BFF.
Reflect.defineMetadata('design:paramtypes', [McpService], McpController);
Reflect.defineMetadata('design:paramtypes', [PrismaService], McpAuthGuard);
@Module({ controllers: [McpController], providers: [
  { provide: PrismaService, useValue: prisma },
  { provide: McpService, useFactory: () => new McpService(prisma as never, { listPublished: async () => [] } as never) },
  { provide: McpAuthGuard, useFactory: () => new McpAuthGuard(prisma as never) },
] })
class FixtureModule {}

describe('MCP OAuth resource and real HTTP protocol', () => {
  let app: INestApplication;
  let jwks: HttpServer;
  let base: string;
  let issuer: string;
  let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let previous: Record<string, string | undefined>;
  beforeAll(async () => {
    previous = { KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER, MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL, MCP_AUDIENCE: process.env.MCP_AUDIENCE };
    const pair = await generateKeyPair('RS256'); key = pair.privateKey;
    const publicJwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
    jwks = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [publicJwk] })));
    await new Promise<void>(resolve => jwks.listen(0, '127.0.0.1', resolve));
    issuer = `http://127.0.0.1:${(jwks.address() as { port: number }).port}/realms/prestige`;
    process.env.KEYCLOAK_ISSUER = issuer;
    process.env.MCP_RESOURCE_URL = 'http://localhost:3000/mcp'; delete process.env.MCP_AUDIENCE;
    app = await NestFactory.create(FixtureModule, { logger: false });
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close(); await new Promise<void>(resolve => jwks?.close(() => resolve()));
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  });
  const token = (overrides: Record<string, unknown> = {}) => new SignJWT({ sub: 'subject1', preferred_username: 'alice', tenant: 'seguridata', scope: 'prestige:read', realm_access: { roles: ['sender'] }, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt().setExpirationTime('5m').setIssuer(issuer).setAudience('http://localhost:3000/mcp').sign(key);
  const rpc = async (auth: string | undefined, method = 'tools/list', params: unknown = {}, headers = {}) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });

  it('serves RFC9728 discovery and a 401 challenge without token', async () => {
    const metadata = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(metadata.authorization_servers).toEqual([issuer]);
    const res = await rpc(undefined); expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('scope="prestige:read"');
  });
  it('negotiates official MCP transport and lists only read tools', async () => {
    const auth = await token();
    const initialized = await rpc(auth, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(initialized.status).toBe(200); expect((await initialized.json()).result.serverInfo.name).toBe('prestige');
    const list = await rpc(auth); expect(list.status).toBe(200);
    const tools = (await list.json()).result.tools; expect(tools).toHaveLength(5);
    expect(tools.every((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint)).toBe(true);
    expect(list.headers.get('mcp-session-id')).toBeNull();
  });
  it('validates signature, exact audience, scope, tenant and origin', async () => {
    const correct = await token();
    expect((await rpc(`${correct.slice(0, -8)}AAAAAAAA`)).status).toBe(401);
    // azp never substitutes for the resource audience.
    const wrongAud = await new SignJWT({ sub: 's', tenant: 'seguridata', scope: 'prestige:read', azp: 'http://localhost:3000/mcp', realm_access: { roles: ['sender'] } }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience('web').setExpirationTime('5m').sign(key);
    expect((await rpc(wrongAud)).status).toBe(401);
    expect((await rpc(await token({ scope: 'openid' }))).status).toBe(403);
    expect((await rpc(correct, 'tools/list', {}, { 'X-Tenant-Id': 'other' })).status).toBe(403);
    expect((await rpc(correct, 'tools/list', {}, { Origin: 'https://hostile.example' })).status).toBe(403);
  });
  it('queries with tenant and actor predicates and rejects arbitrary arguments', async () => {
    const auth = await token();
    const res = await rpc(auth, 'tools/call', { name: 'prestige_my_requests', arguments: { limit: 3 } });
    expect(res.status).toBe(200); expect((await res.json()).result.isError).toBeUndefined();
    expect(prisma.signatureRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'seguridata', OR: expect.arrayContaining([{ requestedBy: 'alice' }]) }), take: 3 }));
    const bad = await rpc(auth, 'tools/call', { name: 'prestige_my_requests', arguments: { tenantId: 'other' } });
    expect((await bad.json()).error.code).toBe(-32602);
    const missing = await rpc(auth, 'tools/call', { name: 'prestige_request_status', arguments: { requestId: 'foreign-id' } });
    expect((await missing.json()).error.code).toBe(-32602);
    expect(prisma.signatureRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'seguridata', id: 'foreign-id' }) }));
  });
  it('fails closed without expiry and forbids unsafe canonical URLs', () => {
    expect(() => validateMcpClaims({ sub: 's', aud: 'r' }, 'r')).toThrow();
    const old = process.env.MCP_RESOURCE_URL; process.env.MCP_RESOURCE_URL = 'http://example.com/mcp';
    expect(() => mcpConfig()).toThrow(); process.env.MCP_RESOURCE_URL = old;
  });
  it('allows a production deployment without MCP and refuses explicit insecure enablement', () => {
    const old = { NODE_ENV: process.env.NODE_ENV, MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL, MCP_ENABLED: process.env.MCP_ENABLED };
    try {
      process.env.NODE_ENV = 'production'; delete process.env.MCP_RESOURCE_URL; delete process.env.MCP_ENABLED;
      expect(mcpConfig().enabled).toBe(false);
      process.env.MCP_ENABLED = 'true'; expect(() => mcpConfig()).toThrow();
      process.env.MCP_RESOURCE_URL = 'http://localhost:3000/mcp'; expect(() => mcpConfig()).toThrow();
    } finally { for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
});
