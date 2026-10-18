import { WorkflowReconcilerService } from '../workflow/workflow-reconciler.service';
/**
 * ADR-004: los métodos de servicio corregidos para `TENANT_GUARD=enforce` se ejecutan
 * contra el cliente Prisma REAL extendido con la guarda (`tenantGuardExtension`) y un
 * «motor» falso que registra cada consulta en vez de ir a Postgres. Si algún `where`
 * o `data` pierde el `tenantId`, la guarda lanza `TenantGuardError` y la prueba falla.
 */
import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AuditChainService } from '../collaboration/audit-chain.service';
import { SloService } from '../control-plane/slo.service';
import { FoldersService } from '../folders/folders.service';
import { InboxController } from '../inbox/inbox.controller';
import { SignatureFieldsService, type SignatureFieldInput } from '../signature-fields/signature-fields.service';
import { SignatureRequestsService } from '../signature-requests/signature-requests.service';
import { SignaturePolicyService } from '../signing/signature-policy';
import { WorkflowService } from '../workflow/workflow.service';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { TenantGuardError, runAsSystem, tenantGuardExtension } from './tenant-guard';
import { TenantIdResolver } from './tenant-id-resolver';
import type { PrismaService } from './prisma.service';

const TENANT = 'acme'; // slug: lo que deja TenantContextGuard
const TENANT_UUID = '11111111-2222-3333-4444-555555555555'; // lo que guardan TenantMembership/Policy

type Call = { model: string; operation: string; args: any };
type Responder = (args: any) => unknown;

/** Cliente real + guarda en `enforce` + motor falso. `respond['Model.op']` fija resultados. */
function makeClient(respond: Record<string, Responder> = {}) {
  const calls: Call[] = [];
  const base = new PrismaClient({ datasources: { db: { url: 'postgresql://u:p@localhost:5432/fake' } } });
  const defaults: Record<string, unknown> = {
    findMany: [],
    findFirst: null,
    findUnique: null,
    count: 0,
    updateMany: { count: 0 },
    deleteMany: { count: 0 },
  };
  const guarded = base.$extends(tenantGuardExtension({ mode: () => 'enforce' }));
  const client = guarded.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args }: { model: string; operation: string; args: any }) {
          calls.push({ model, operation, args });
          const custom = respond[`${model}.${operation}`];
          if (custom) return Promise.resolve(custom(args));
          if (operation === 'create' || operation === 'upsert') return Promise.resolve({ id: 'new', ...(args?.data ?? {}) });
          if (operation === 'createMany') return Promise.resolve({ count: args?.data?.length ?? 0 });
          return Promise.resolve(operation in defaults ? defaults[operation] : { id: 'x' });
        },
      },
      $queryRaw: () => Promise.resolve([{ avg_seconds: null }]),
    },
  });
  // `$transaction(fn)` abriría una transacción real en el motor: se ejecuta sobre el mismo cliente (con guarda).
  const prisma = new Proxy(client as object, {
    get: (target, prop, recv) =>
      prop === '$transaction'
        ? (fn: (tx: unknown) => unknown) => fn(client)
        : Reflect.get(target, prop, recv),
  }) as unknown as PrismaService;
  return { prisma, calls, client: client as any };
}

const resolverFor = (prisma: PrismaService) => new TenantIdResolver(prisma);
const tenantLookup: Record<string, Responder> = { 'Tenant.findFirst': () => ({ id: TENANT_UUID }) };

const field = (documentId: string): SignatureFieldInput => ({
  documentId,
  signerId: 'ana',
  type: 'SIGNATURE',
  page: 1,
  xPct: 0.1,
  yPct: 0.1,
  widthPct: 0.2,
  heightPct: 0.1,
});

describe('TENANT_GUARD=enforce: el cliente extendido rechaza lo que no fija tenantId (control)', () => {
  it('claves únicas y filtros amplios se rechazan antes de llegar al motor', async () => {
    const { client, calls } = makeClient();
    for (const operation of ['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']) {
      await expect(client.document[operation]({ where: { id: 'foreign-document' }, data: {}, create: { tenantId: TENANT }, update: {} }))
        .rejects.toBeInstanceOf(TenantGuardError);
    }
    for (const tenantId of [null, {}, { not: TENANT }, { in: [TENANT, 'foreign'] }]) {
      await expect(client.document.findMany({ where: { id: { not: '' }, tenantId } })).rejects.toBeInstanceOf(TenantGuardError);
    }
    expect(calls).toHaveLength(0);
    await client.document.findUnique({ where: { id: 'own-document', tenantId: TENANT } });
    expect(calls).toHaveLength(1);
  });

  it('una consulta masiva sin tenantId SÍ lanza TenantGuardError con este cliente', async () => {
    const { prisma } = makeClient();
    await expect((prisma as any).signatureField.findMany({ where: { documentId: 'd' } })).rejects.toBeInstanceOf(
      TenantGuardError,
    );
    await expect(
      (prisma as any).policy.findFirst({ where: { key: 'k', tenant: { OR: [{ id: 'a' }, { slug: 'a' }] } } }),
    ).rejects.toBeInstanceOf(TenantGuardError);
  });
});

describe('runAsSystem con consultas perezosas de Prisma', () => {
  it('el reconciliador puede seleccionar corridas globales sin eximir otros llamadores', async () => {
    const { prisma, calls } = makeClient();
    const svc = new WorkflowReconcilerService(prisma, {} as WorkflowService);
    await expect(svc.reconcile()).resolves.toMatchObject({ checked: 0 });
    expect(calls.some(c => c.model === 'WorkflowRun' && c.operation === 'findMany')).toBe(true);
    await expect(prisma.workflowRun.findMany({ where: { status: 'ACTIVO' } })).rejects.toBeInstanceOf(TenantGuardError);
    await expect(prisma.notificationOutbox.findMany({ where: { status: 'PENDIENTE' } })).rejects.toBeInstanceOf(TenantGuardError);
    await expect(prisma.notificationOutbox.updateMany({ where: { status: 'PENDIENTE' }, data: { status: 'FALLIDO' } })).rejects.toBeInstanceOf(TenantGuardError);
  });

  it('una consulta devuelta SIN await dentro del bloque sigue exenta (se espera dentro del contexto)', async () => {
    const { prisma } = makeClient();
    await expect(
      runAsSystem('prueba', () => (prisma as any).humanTask.findMany({ where: { status: 'CREADA' } })),
    ).resolves.toEqual([]);
    // fuera del bloque vuelve a regir
    await expect((prisma as any).humanTask.findMany({ where: { status: 'CREADA' } })).rejects.toBeInstanceOf(
      TenantGuardError,
    );
  });
});

describe('TENANT_GUARD=enforce: servicios corregidos no lanzan TenantGuardError', () => {
  it('TenantContextGuard: la búsqueda de membresías por usuario va como sistema y fija el slug', async () => {
    const { prisma, calls } = makeClient({
      'TenantMembership.findMany': () => [
        { tenantId: TENANT_UUID, userId: 'maria', tenant: { id: TENANT_UUID, slug: TENANT, active: true } },
      ],
    });
    const guard = new TenantContextGuard({ getAllAndOverride: () => false } as never, prisma);
    const request = { user: { actorId: 'maria', sub: 'maria', tenantId: TENANT }, headers: {} };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
    expect(request.user.tenantId).toBe(TENANT);
    expect(calls.map((c) => `${c.model}.${c.operation}`)).toEqual(['TenantMembership.findMany']);
  });

  it('SignaturePolicyService.resolve: slug -> uuid y findUnique por tenantId_key', async () => {
    const { prisma, calls } = makeClient({
      ...tenantLookup,
      'Policy.findUnique': () => ({ version: 4, value: { defaultSlaHours: 10 } }),
    });
    const policy = await new SignaturePolicyService(prisma, resolverFor(prisma)).resolve(TENANT);
    expect(policy).toMatchObject({ source: 'tenant', version: 4, defaultSlaHours: 10 });
    const lookup = calls.find((c) => c.model === 'Policy');
    expect(lookup?.args.where.tenantId_key.tenantId).toBe(TENANT_UUID);
  });

  it('SignatureFieldsService: create, list, remove y reemplazo en bulk', async () => {
    const { prisma, calls } = makeClient({
      'Document.findFirst': () => ({ id: 'doc-1' }),
      'SignatureField.findFirst': () => ({ id: 'f-1' }),
    });
    const svc = new SignatureFieldsService(prisma);
    await svc.create(field('doc-1'), TENANT);
    await svc.listByDocument('doc-1', TENANT);
    await svc.remove('f-1', TENANT);
    await svc.createMany('doc-1', [field('doc-1')], TENANT);
    await svc.createMany('doc-1', [], TENANT);
    const sf = calls.filter((c) => c.model === 'SignatureField');
    for (const c of sf.filter((c) => ['findMany', 'deleteMany', 'findFirst'].includes(c.operation))) {
      expect(c.args.where.tenantId).toBe(TENANT);
    }
    expect(sf.some((c) => c.operation === 'deleteMany')).toBe(true);
  });

  it('InboxController: colleagues (membresías por uuid) y snapshot', async () => {
    const { prisma, calls } = makeClient({
      ...tenantLookup,
      'TenantMembership.findMany': () => [{ id: 'm1', userId: 'ana', name: 'Ana', email: null }],
    });
    const ctrl = new InboxController({} as never, prisma, resolverFor(prisma));
    const user = { actorId: 'maria', sub: 'maria', tenantId: TENANT, roles: [] } as never;
    const out = await ctrl.colleagues({} as never, user);
    expect(JSON.stringify(out)).toContain('ana');
    const m = calls.find((c) => c.model === 'TenantMembership');
    expect(m?.args.where.tenantId).toBe(TENANT_UUID);
    await expect(ctrl.snapshot(user)).resolves.toEqual({ unread: 0, pendingTasks: 0, pendingSign: 0 });
  });

  it('SignatureRequestsService: resolveSigners y aviso de turno', async () => {
    const { prisma, calls } = makeClient({
      ...tenantLookup,
      'TenantMembership.findMany': () => [{ userId: 'ana', name: 'Ana', email: 'ana@a.mx' }],
      'Document.findUnique': () => ({ filename: 'x.pdf' }),
    });
    const collab = { notify: vi.fn(), audit: vi.fn() };
    const mail = { sendInvite: vi.fn().mockResolvedValue(undefined) };
    const svc = new SignatureRequestsService(
      prisma,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      collab as never,
      mail as never,
      undefined as never,
      undefined as never,
      undefined as never,
      resolverFor(prisma),
    );
    const priv = svc as unknown as {
      resolveSigners(t: string, s: { signerId: string; email?: string }[]): Promise<{ signerId: string }[]>;
      notifyNextInSequence(r: unknown): Promise<void>;
    };
    expect(await priv.resolveSigners(TENANT, [{ signerId: 'ANA@a.mx' }])).toEqual([
      expect.objectContaining({ signerId: 'ana' }),
    ]);
    await priv.notifyNextInSequence({
      id: 'req-1',
      documentId: 'doc-1',
      tenantId: TENANT,
      signers: [{ signerId: 'ana', name: 'Ana', status: 'PENDIENTE', sortOrder: 1 }],
    });
    expect(calls.find((c) => c.model === 'TenantMembership')?.args.where.tenantId).toBe(TENANT_UUID);
    expect(calls.find((c) => c.model === 'ProcessAuditEvent')?.args.where.tenantId).toBe(TENANT);
    expect(calls.find((c) => c.model === 'HumanTask')?.args.where.tenantId).toBe(TENANT);
  });

  it('SignatureRequestsService.delegate: destinatario por uuid de tenant', async () => {
    const { prisma, calls } = makeClient({
      ...tenantLookup,
      'TenantMembership.findFirst': () => null,
      'SignatureRequest.findFirst': () => ({
        id: 'req-1',
        tenantId: TENANT,
        status: 'EN_FIRMA',
        signers: [{ id: 's1', signerId: 'ana', status: 'PENDIENTE' }],
      }),
    });
    const svc = new SignatureRequestsService(
      prisma,
      ...(Array(11).fill(undefined) as [never, never, never, never, never, never, never, never, never, never, never]),
      resolverFor(prisma),
    );
    // Destinatario inexistente => 400, pero la consulta de membresía ya pasó por la guarda.
    await expect(
      svc.delegate('req-1', { fromSignerId: 'ana', toSignerId: 'zed' } as never, TENANT),
    ).rejects.not.toBeInstanceOf(TenantGuardError);
    expect(calls.find((c) => c.model === 'TenantMembership')?.args.where.tenantId).toBe(TENANT_UUID);
  });

  it('WorkflowService: señales, cancelación, delegación, expiración, seed, reasignación y nudge', async () => {
    const { prisma, calls } = makeClient({
      ...tenantLookup,
      'SignatureRequest.findFirst': () => ({ id: 'req-1' }),
      'SignatureRequest.findUnique': () => ({
        id: 'req-1',
        tenantId: TENANT,
        status: 'EN_FIRMA',
        documentId: 'doc-1',
        requestedBy: 'maria',
        document: { filename: 'x.pdf' },
      }),
      'HumanTask.findFirst': () => ({ id: 't1', tenantId: TENANT, signerId: 'maria', claimedBy: null }),
      'HumanTask.findMany': () => [
        { id: 't1', signerId: 'ana', delegatedFrom: null, priority: 1, remindersSent: 0, lastReminderAt: null, escalatedAt: null },
      ],
      'TenantMembership.findFirst': () => ({ id: 'm1' }),
    });
    const auditChain = { append: vi.fn().mockResolvedValue(undefined) };
    const mail = {
      sendReminder: vi.fn().mockResolvedValue(undefined),
      sendEscalation: vi.fn().mockResolvedValue(undefined),
    };
    const evidence = { generateForRequest: vi.fn().mockResolvedValue(undefined) };
    const svc = new WorkflowService(prisma, evidence as never, mail as never, auditChain as never, resolverFor(prisma));
    const admin = { actorId: 'root', tenantId: TENANT, roles: ['admin'] };

    await svc.describe('req-1', TENANT);
    await svc.signalSigned('req-1', 'ana', TENANT);
    await svc.signalRejected('req-1', 'ana', TENANT);
    await svc.cancelRun('req-1', TENANT);
    await svc.reassignForDelegation('req-1', 'ana', 'beto', TENANT);
    await svc.expire('req-1', TENANT);
    await svc.seal('req-1', TENANT);
    await svc.reassignTask('t1', 'beto', admin);
    await svc.seedTasks(
      { signatureRequestId: 'req-1', documentId: 'doc-1', slaHours: 1, signers: [{ signerId: 'ana' }] } as never,
      'wf-1',
      TENANT,
    );
    await svc.nudge({ signatureRequestId: 'req-1', tenantId: TENANT, kind: 'ESCALATION', ratio: 0.9 } as never);
    await svc.nudge({ signatureRequestId: 'req-1', tenantId: TENANT, kind: 'REMINDER', ratio: 0.5 } as never);

    const mass = calls.filter((c) => ['updateMany', 'findMany', 'count'].includes(c.operation));
    expect(mass.length).toBeGreaterThan(8);
    expect(calls.find((c) => c.model === 'TenantMembership')?.args.where.tenantId).toBe(TENANT_UUID);
  });

  it('FoldersService.remove: cuenta hijos y casos del tenant', async () => {
    const { prisma, calls } = makeClient({ 'Folder.findFirst': () => ({ id: 'f1' }) });
    await new FoldersService(prisma).remove('f1', { tenantId: TENANT, ownerId: 'maria' });
    for (const c of calls.filter((c) => c.operation === 'count')) expect(c.args.where.tenantId).toBe(TENANT);
  });

  it('AuditChainService.verify: con tenant va acotada; sin tenant (global) va como sistema', async () => {
    const { prisma, calls } = makeClient();
    const svc = new AuditChainService(prisma);
    await svc.verify({ tenantId: TENANT, signatureRequestId: 'req-1' });
    await svc.verify();
    expect(calls.filter((c) => c.model === 'ProcessAuditEvent')).toHaveLength(2);
  });

  it('SloService: snapshot por tenant y snapshot global (sistema)', async () => {
    const { prisma } = makeClient();
    const svc = new SloService(prisma);
    await svc.snapshot(TENANT);
    await svc.snapshotGlobal();
  });
});
