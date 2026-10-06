import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type {
  RequestStatus,
  SignatureMethod,
  SignerRole,
  SignerStatus,
  SigningOrder,
} from '@prisma/client';

import { SignatureRequestsService } from './signature-requests.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { EvidenceService } from '../evidence/evidence.service';
import type { PrismaService } from '../prisma/prisma.service';

const PDF_BYTES = Buffer.from('%PDF-1.4');
const PDF_HASH = createHash('sha256').update(PDF_BYTES).digest('hex');

interface FakeRequestRow {
  id: string;
  documentId: string;
  tenantId: string;
  methods: SignatureMethod[];
  order: SigningOrder;
  status: RequestStatus;
  requestedBy?: string;
  requestedByName?: string;
  expiresAt?: Date | null;
  requirePasskey: boolean;
  kycPolicy: 'NONE';
  createdAt: Date;
}

interface FakeSignerRow {
  id: string;
  signatureRequestId: string;
  signerId: string;
  name?: string;
  email?: string;
  role: SignerRole;
  status: SignerStatus;
  signedAt: Date | null;
  usedMethod?: SignatureMethod;
  sortOrder: number;
  delegatedTo: string | null;
  delegatedToName: string | null;
  pendingRef: string | null;
  pendingSince: Date | null;
}

interface FakeDoc {
  id: string;
  tenantId: string;
  hash: string;
  locked: boolean;
  objectKey: string;
  enc: object;
  filename: string;
  caseId: string;
  presentedObjectKey: string | null;
  presentedEnc: object | null;
}

type Cond<T> = T | { in: T[] } | undefined;
const matches = <T>(value: T, cond: Cond<T>) =>
  cond === undefined ||
  (typeof cond === 'object' && cond !== null && 'in' in (cond as object)
    ? (cond as { in: T[] }).in.includes(value)
    : value === cond);

/**
 * Mock en memoria de PrismaService con los Maps que `SignatureRequestsService`
 * toca. `$transaction` SERIALIZA las transacciones con un mutex: es la
 * simulación del `SELECT ... FOR UPDATE` sobre la fila del documento que hace
 * el servicio (dos firmas del mismo documento nunca se intercalan).
 */
function createFakePrisma(seed: {
  requests: FakeRequestRow[];
  signers: FakeSignerRow[];
  doc?: Partial<FakeDoc>;
  members?: { userId: string; name: string | null; email: string | null; tenantId: string }[];
  manifest?: boolean;
}) {
  const requests = new Map(seed.requests.map((r) => [r.id, { ...r }]));
  const signers = new Map(seed.signers.map((s) => [s.id, { ...s }]));
  const doc: FakeDoc = {
    id: 'doc-1',
    tenantId: 'seguridata',
    hash: PDF_HASH,
    locked: true,
    objectKey: 'documents/2026-01-01/obj-1.pdf',
    enc: { v: 1 },
    filename: 'contrato.pdf',
    caseId: 'case-1',
    presentedObjectKey: null,
    presentedEnc: null,
    ...seed.doc,
  };
  const manifests = new Set<string>(seed.manifest ? seed.requests.map((r) => r.id) : []);
  const calls = { queryRaw: 0, txOptions: [] as unknown[] };
  let chain: Promise<unknown> = Promise.resolve();

  const signersOf = (id: string) =>
    [...signers.values()].filter((s) => s.signatureRequestId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const hydrate = (req: FakeRequestRow, include?: { signers?: unknown; document?: unknown }) => ({
    ...req,
    ...(include?.signers ? { signers: signersOf(req.id).map((s) => ({ ...s })) } : {}),
    document: { ...doc },
  });
  const findReq = ({
    where,
    include,
  }: {
    where: { id: string; tenantId?: string };
    include?: { signers?: unknown };
  }) => {
    const req = requests.get(where.id);
    if (!req || (where.tenantId && req.tenantId !== where.tenantId)) return null;
    return hydrate(req, include ?? { signers: true });
  };

  const api = {
    signatureRequest: {
      findUnique: async (args: Parameters<typeof findReq>[0]) => findReq(args),
      findFirst: async (args: Parameters<typeof findReq>[0]) => findReq(args),
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: Partial<FakeRequestRow>;
        include?: { signers?: unknown };
      }) => {
        const req = requests.get(where.id);
        if (!req) throw new Error(`signatureRequest ${where.id} no existe en el fixture`);
        Object.assign(req, data);
        return hydrate(req, include);
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; tenantId?: string; status?: Cond<RequestStatus> };
        data: Partial<FakeRequestRow>;
      }) => {
        const req = requests.get(where.id);
        if (!req) return { count: 0 };
        if (where.tenantId && req.tenantId !== where.tenantId) return { count: 0 };
        if (!matches(req.status, where.status)) return { count: 0 };
        Object.assign(req, data);
        return { count: 1 };
      },
    },
    signer: {
      findMany: async ({ where }: { where: { signatureRequestId: string } }) =>
        signersOf(where.signatureRequestId).map((s) => ({ ...s })),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeSignerRow> }) => {
        const s = signers.get(where.id);
        if (!s) throw new Error(`signer ${where.id} no existe en el fixture`);
        Object.assign(s, data);
        return { ...s };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; signatureRequestId?: string; status?: Cond<SignerStatus> };
        data: Partial<FakeSignerRow>;
      }) => {
        let count = 0;
        for (const s of signers.values()) {
          if (where.id && s.id !== where.id) continue;
          if (where.signatureRequestId && s.signatureRequestId !== where.signatureRequestId) continue;
          if (!matches(s.status, where.status)) continue;
          Object.assign(s, data);
          count += 1;
        }
        return { count };
      },
    },
    $queryRaw: async () => {
      calls.queryRaw += 1;
      return [];
    },
    // El servicio real hace `this.prisma.$transaction(async (tx) => {...}, opts)`.
    // El fixture comparte los mismos Maps con la "tx"; el mutex emula el bloqueo
    // de fila `FOR UPDATE` que serializa las firmas concurrentes.
    $transaction: <T>(fn: (tx: typeof api) => Promise<T>, opts?: unknown): Promise<T> => {
      calls.txOptions.push(opts);
      const run = chain.then(() => fn(api));
      chain = run.catch(() => undefined);
      return run;
    },
    consentAcceptance: {
      findUnique: async () => ({ id: 'consent-1', textVersion: '1.1' }),
      upsert: async ({ create }: { create: Record<string, unknown> }) => create,
    },
    signatureField: { findFirst: async () => null },
    document: {
      update: async ({ data }: { data: Partial<FakeDoc> }) => Object.assign(doc, data),
    },
    evidenceManifest: {
      findUnique: async ({ where }: { where: { signatureRequestId: string } }) =>
        manifests.has(where.signatureRequestId) ? { id: 'ev-1' } : null,
    },
    tenantMembership: {
      findFirst: async ({
        where,
      }: {
        where: { tenant: { OR: { id?: string; slug?: string }[] }; OR: { userId?: string; email?: { equals: string } }[] };
      }) => {
        const tenantKeys = where.tenant.OR.flatMap((o) => [o.id, o.slug]);
        return (
          (seed.members ?? []).find(
            (m) =>
              tenantKeys.includes(m.tenantId) &&
              where.OR.some(
                (c) => c.userId === m.userId || (c.email && m.email?.toLowerCase() === c.email.equals.toLowerCase()),
              ),
          ) ?? null
        );
      },
    },
  };

  return { prisma: api as unknown as PrismaService, requests, signers, doc, manifests, calls };
}

function makeService(
  seed: Parameters<typeof createFakePrisma>[0],
  opts: { signHook?: () => Promise<void>; signedPdf?: Buffer; storageBytes?: Buffer } = {},
) {
  const { prisma, requests, signers, doc, manifests, calls } = createFakePrisma(seed);
  const realtime = { notifyDocumentEvent: vi.fn() } as unknown as RealtimeGateway;
  const evidence = { generateForRequest: vi.fn().mockResolvedValue(undefined) };
  const workflow = {
    startInstance: vi.fn().mockResolvedValue({ id: 'wf' }),
    signalSigned: vi.fn().mockResolvedValue(undefined),
    signalRejected: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
    reassignForDelegation: vi.fn().mockResolvedValue(undefined),
  };
  const signing = {
    sign: vi.fn(async () => {
      await opts.signHook?.();
      return {
        algorithm: 'HMAC-SHA256',
        signatureHash: 'x',
        provider: 'test',
        ...(opts.signedPdf ? { signedPdf: opts.signedPdf } : {}),
      };
    }),
    capabilities: vi.fn().mockReturnValue([]),
  };
  const storage = {
    getObject: vi.fn().mockResolvedValue(opts.storageBytes ?? PDF_BYTES),
    putObject: vi.fn().mockResolvedValue({
      objectKey: 'presented/obj-2.pdf',
      sha256: 'def',
      sizeBytes: 15,
      enc: { v: 1 },
    }),
  };
  const collab = { notify: vi.fn(), audit: vi.fn() };
  const mail = {
    sendInvite: vi.fn().mockResolvedValue(undefined),
    sendInvites: vi.fn().mockResolvedValue(undefined),
    sendCompleted: vi.fn().mockResolvedValue(undefined),
  };
  const policyService = {
    resolve: vi.fn().mockResolvedValue({ version: 0, source: 'default', allowedMethods: ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA'] }),
    enforce: vi.fn((_p: unknown, r: { order?: string; slaHours?: number }) => ({
      order: r.order ?? 'SECUENCIAL',
      slaHours: r.slaHours ?? 72,
    })),
  };
  const documents = { freeze: vi.fn().mockResolvedValue({ locked: true }) };

  const service = new SignatureRequestsService(
    prisma,
    realtime,
    evidence as unknown as EvidenceService,
    workflow as never,
    signing as never,
    {} as never,
    storage as never,
    collab as never,
    mail as never,
    policyService as never,
    undefined as never,
    documents as never,
  );
  return { service, requests, signers, doc, manifests, calls, realtime, evidence, workflow, signing, storage, collab, mail, documents };
}

const REQUEST_ID = 'req-1';
const DOCUMENT_ID = 'doc-1';

function baseRequest(overrides: Partial<FakeRequestRow> = {}): FakeRequestRow {
  return {
    id: REQUEST_ID,
    documentId: DOCUMENT_ID,
    tenantId: 'seguridata',
    methods: ['DIGITAL'],
    order: 'SECUENCIAL',
    status: 'PENDIENTE',
    requestedBy: 'maria',
    requestedByName: 'María González',
    expiresAt: null,
    requirePasskey: false,
    kycPolicy: 'NONE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function signerRow(overrides: Partial<FakeSignerRow>): FakeSignerRow {
  return {
    id: overrides.id ?? `signer-${overrides.signerId}`,
    signatureRequestId: REQUEST_ID,
    signerId: 'signer-a',
    role: 'FIRMANTE',
    status: 'PENDIENTE',
    signedAt: null,
    sortOrder: 0,
    delegatedTo: null,
    delegatedToName: null,
    pendingRef: null,
    pendingSince: null,
    ...overrides,
  };
}

const twoSigners = () => [
  signerRow({ signerId: 'primero', sortOrder: 0 }),
  signerRow({ signerId: 'segundo', sortOrder: 1 }),
];
const SIGN = { method: 'DIGITAL' as const, consentAccepted: true };

describe('SignatureRequestsService.sign — orden secuencial', () => {
  it('rechaza la firma de un firmante posterior mientras haya uno anterior PENDIENTE', async () => {
    const { service, realtime } = makeService({ requests: [baseRequest()], signers: twoSigners() });
    await expect(service.sign(REQUEST_ID, { signerId: 'segundo', ...SIGN })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
  });

  it('permite firmar al primer firmante y avanza la solicitud a EN_FIRMA', async () => {
    const { service, signers, realtime } = makeService({ requests: [baseRequest()], signers: twoSigners() });
    const result = await service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN });
    expect(result.requestStatus).toBe('EN_FIRMA');
    expect(result.status).toBe('FIRMADO');
    expect(signers.get('signer-primero')?.status).toBe('FIRMADO');
    expect(realtime.notifyDocumentEvent).toHaveBeenCalledTimes(1);
    expect(realtime.notifyDocumentEvent).toHaveBeenCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({ type: 'SIGNATURE_APPLIED', actorId: 'primero' }),
    );
  });

  it('no exige orden alguno cuando la solicitud es PARALELO', async () => {
    const { service } = makeService({ requests: [baseRequest({ order: 'PARALELO' })], signers: twoSigners() });
    const result = await service.sign(REQUEST_ID, { signerId: 'segundo', ...SIGN });
    expect(result.requestStatus).toBe('EN_FIRMA');
  });
});

describe('SignatureRequestsService.sign — idempotencia', () => {
  it('reintentar la firma de quien ya firmó no lo vuelve a marcar ni notifica', async () => {
    const { service, signers, realtime, evidence } = makeService({
      requests: [baseRequest({ status: 'EN_FIRMA' })],
      signers: [
        signerRow({ signerId: 'primero', status: 'FIRMADO', signedAt: new Date('2026-01-01T10:00:00Z'), usedMethod: 'DIGITAL' }),
        signerRow({ signerId: 'segundo', sortOrder: 1 }),
      ],
    });
    const result = await service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN });
    expect(result.requestStatus).toBe('EN_FIRMA');
    expect(signers.get('signer-primero')?.signedAt).toEqual(new Date('2026-01-01T10:00:00Z'));
    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
    expect(evidence.generateForRequest).not.toHaveBeenCalled();
  });

  it('actuar sobre una solicitud COMPLETADA con evidencia ya generada no cambia nada', async () => {
    const { service, requests, realtime, evidence, workflow } = makeService({
      requests: [baseRequest({ status: 'COMPLETADA' })],
      signers: [signerRow({ signerId: 'primero', status: 'FIRMADO', signedAt: new Date(), usedMethod: 'DIGITAL' })],
      manifest: true,
    });
    const result = await service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN });
    expect(result.requestStatus).toBe('COMPLETADA');
    expect(requests.get(REQUEST_ID)?.status).toBe('COMPLETADA');
    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
    expect(evidence.generateForRequest).not.toHaveBeenCalled();
    expect(workflow.signalSigned).not.toHaveBeenCalled();
  });

  it('actuar sobre una solicitud RECHAZADA tampoco reabre el flujo ni notifica', async () => {
    const { service, realtime } = makeService({
      requests: [baseRequest({ status: 'RECHAZADA' })],
      signers: [signerRow({ signerId: 'primero', status: 'RECHAZADO' })],
    });
    const result = await service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN });
    expect(result.requestStatus).toBe('RECHAZADA');
    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
  });

  it('firmar al último firmante completa la solicitud y genera la evidencia una sola vez', async () => {
    const { service, realtime, evidence } = makeService({
      requests: [baseRequest()],
      signers: [signerRow({ signerId: 'unico' })],
    });
    const result = await service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' });
    expect(result.requestStatus).toBe('COMPLETADA');
    expect(realtime.notifyDocumentEvent).toHaveBeenCalledTimes(2);
    expect(realtime.notifyDocumentEvent).toHaveBeenNthCalledWith(1, DOCUMENT_ID, expect.objectContaining({ type: 'SIGNATURE_APPLIED' }));
    expect(realtime.notifyDocumentEvent).toHaveBeenNthCalledWith(2, DOCUMENT_ID, expect.objectContaining({ type: 'REQUEST_COMPLETED' }));
    expect(evidence.generateForRequest).toHaveBeenCalledTimes(1);
    expect(evidence.generateForRequest).toHaveBeenCalledWith(REQUEST_ID);
  });

  it('reintento sobre COMPLETADA SIN evidencia (el post-commit falló) la vuelve a generar y re-señala', async () => {
    const { service, evidence, workflow, mail } = makeService({
      requests: [baseRequest({ status: 'COMPLETADA' })],
      signers: [signerRow({ signerId: 'unico', status: 'FIRMADO', signedAt: new Date(), usedMethod: 'DIGITAL' })],
      manifest: false,
    });
    const result = await service.sign(REQUEST_ID, { signerId: 'unico', ...SIGN });
    expect(result.requestStatus).toBe('COMPLETADA');
    expect(workflow.signalSigned).toHaveBeenCalledWith(REQUEST_ID, 'unico');
    expect(evidence.generateForRequest).toHaveBeenCalledTimes(1);
    expect(mail.sendCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('SignatureRequestsService.sign — respuesta mínima y efectos post-commit', () => {
  it('devuelve sólo {status, signedAt, requestStatus}: ni signedPdf ni datos de otros firmantes', async () => {
    const { service } = makeService(
      { requests: [baseRequest({ order: 'PARALELO' })], signers: twoSigners() },
      { signedPdf: Buffer.from('%PDF-1.4 firmado') },
    );
    const result = await service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN });
    expect(Object.keys(result).sort()).toEqual(['requestStatus', 'signedAt', 'status']);
    expect(result.status).toBe('FIRMADO');
    expect(result.signedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(result)).not.toContain('segundo');
  });

  it('si workflow.signalSigned o evidence.generateForRequest fallan, la firma ya commiteada NO falla', async () => {
    const ctx = makeService({ requests: [baseRequest()], signers: [signerRow({ signerId: 'unico' })] });
    ctx.workflow.signalSigned.mockRejectedValueOnce(new Error('temporal caído'));
    ctx.evidence.generateForRequest.mockRejectedValueOnce(new Error('storage caído'));
    const result = await ctx.service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' });
    expect(result.requestStatus).toBe('COMPLETADA');
    expect(ctx.signers.get('signer-unico')?.status).toBe('FIRMADO');
    // Sin evidencia: no se manda el correo de "completada" todavía.
    expect(ctx.mail.sendCompleted).not.toHaveBeenCalled();

    // El reintento del firmante (alreadySigned + COMPLETADA sin manifiesto) lo repara.
    await ctx.service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' });
    expect(ctx.evidence.generateForRequest).toHaveBeenCalledTimes(2);
    expect(ctx.mail.sendCompleted).toHaveBeenCalledTimes(1);
  });

  it('la transacción de firma lleva timeout explícito y bloquea la fila del documento', async () => {
    const { service, calls } = makeService({ requests: [baseRequest()], signers: [signerRow({ signerId: 'unico' })] });
    await service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' });
    expect(calls.txOptions[0]).toMatchObject({ timeout: 30_000 });
    expect(calls.queryRaw).toBe(1);
  });
});

describe('SignatureRequestsService.sign — FREEZE, hash y expiración', () => {
  it('rechaza con 409 DOCUMENT_NOT_FROZEN si el documento no está congelado', async () => {
    const { service, signing } = makeService({
      requests: [baseRequest()],
      signers: [signerRow({ signerId: 'unico' })],
      doc: { locked: false },
    });
    const err = await service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ error: 'DOCUMENT_NOT_FROZEN' });
    expect(signing.sign).not.toHaveBeenCalled();
  });

  it('SIEMPRE rehashea el canónico: storage alterado => 409 HASH_MISMATCH y no se firma', async () => {
    const { service, signing, signers } = makeService(
      { requests: [baseRequest()], signers: [signerRow({ signerId: 'unico' })] },
      { storageBytes: Buffer.from('%PDF-1.4 ALTERADO') },
    );
    const err = await service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ error: 'HASH_MISMATCH' });
    expect(signing.sign).not.toHaveBeenCalled();
    // (el EN_PROCESO del claim lo revierte el rollback real de la tx; el fixture no lo emula)
    expect(signers.get('signer-unico')?.status).not.toBe('FIRMADO');
  });

  it('una solicitud vencida responde 410, queda EXPIRADA y no se firma', async () => {
    const { service, requests, signers, signing, collab } = makeService({
      requests: [baseRequest({ expiresAt: new Date(Date.now() - 1000) })],
      signers: [signerRow({ signerId: 'unico' })],
    });
    await expect(service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' })).rejects.toBeInstanceOf(GoneException);
    expect(requests.get(REQUEST_ID)?.status).toBe('EXPIRADA');
    expect(signers.get('signer-unico')?.status).toBe('PENDIENTE');
    expect(signing.sign).not.toHaveBeenCalled();
    expect(collab.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'REQUEST_EXPIRED' }));
  });

  it('rechaza un método no autorizado para la solicitud', async () => {
    const { service } = makeService({ requests: [baseRequest()], signers: [signerRow({ signerId: 'unico' })] });
    await expect(service.sign(REQUEST_ID, { signerId: 'unico', method: 'BIOMETRICA' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SignatureRequestsService.sign — concurrencia', () => {
  it('dos firmas PARALELO simultáneas dejan la solicitud COMPLETADA (no EN_FIRMA) y generan evidencia una vez', async () => {
    const { service, requests, signers, evidence } = makeService(
      { requests: [baseRequest({ order: 'PARALELO' })], signers: twoSigners() },
      // Cede el turno dentro de la tx para forzar el intercalado si no hubiera bloqueo.
      { signHook: () => new Promise((r) => setTimeout(r, 5)) },
    );
    const [a, b] = await Promise.all([
      service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN }),
      service.sign(REQUEST_ID, { signerId: 'segundo', ...SIGN }),
    ]);
    expect(signers.get('signer-primero')?.status).toBe('FIRMADO');
    expect(signers.get('signer-segundo')?.status).toBe('FIRMADO');
    expect(requests.get(REQUEST_ID)?.status).toBe('COMPLETADA');
    expect([a.requestStatus, b.requestStatus].sort()).toEqual(['COMPLETADA', 'EN_FIRMA']);
    expect(evidence.generateForRequest).toHaveBeenCalledTimes(1);
  });

  it('el doble envío concurrente del MISMO firmante firma una sola vez', async () => {
    const { service, signing, realtime } = makeService(
      { requests: [baseRequest({ order: 'PARALELO' })], signers: twoSigners() },
      { signHook: () => new Promise((r) => setTimeout(r, 5)) },
    );
    await Promise.all([
      service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN }),
      service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN }),
    ]);
    expect(signing.sign).toHaveBeenCalledTimes(1);
    expect(realtime.notifyDocumentEvent).toHaveBeenCalledTimes(1);
  });
});

describe('SignatureRequestsService — aislamiento por tenant (A/B)', () => {
  const seed = () => ({
    requests: [baseRequest({ tenantId: 'tenant-a' })],
    signers: twoSigners(),
    members: [{ userId: 'tercero', name: 'Tercero', email: 'tercero@a.mx', tenantId: 'tenant-a' }],
  });

  it('tenant B recibe 404 en getOrThrow, recordConsent, sign, reject, cancel y delegate', async () => {
    const { service, requests, signers, workflow } = makeService(seed());
    await expect(service.getOrThrow(REQUEST_ID, 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.recordConsent(REQUEST_ID, { signerId: 'primero' }, 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN }, undefined, 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reject(REQUEST_ID, { signerId: 'primero' }, 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancel(REQUEST_ID, { actorId: 'x' }, 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'tercero' }, 'tenant-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Nada cambió en la solicitud del tenant A.
    expect(requests.get(REQUEST_ID)?.status).toBe('PENDIENTE');
    expect([...signers.values()].every((s) => s.status === 'PENDIENTE' && !s.delegatedTo)).toBe(true);
    expect(workflow.signalRejected).not.toHaveBeenCalled();
  });

  it('el tenant dueño (A) sí opera normalmente', async () => {
    const { service } = makeService(seed());
    const result = await service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN }, undefined, 'tenant-a');
    expect(result.status).toBe('FIRMADO');
  });

  it('recordConsent rechaza a quien no es firmante de la solicitud', async () => {
    const { service } = makeService(seed());
    await expect(service.recordConsent(REQUEST_ID, { signerId: 'intruso' }, 'tenant-a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recordConsent es idempotente: dos llamadas => un solo registro (y el perdedor de la carrera P2002 recibe el existente)', async () => {
    const { service } = makeService(seed());
    const rows: Array<Record<string, unknown>> = [];
    const prisma = (service as unknown as { prisma: { consentAcceptance: unknown } }).prisma;
    prisma.consentAcceptance = {
      findUnique: async () => rows[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        rows.push({ id: 'c1', ...data });
        return rows[rows.length - 1];
      },
    };
    const a = await service.recordConsent(REQUEST_ID, { signerId: 'primero', ip: '1.1.1.1' }, 'tenant-a');
    const b = await service.recordConsent(REQUEST_ID, { signerId: 'primero', ip: '2.2.2.2' }, 'tenant-a');
    expect(rows).toHaveLength(1);
    expect(b).toBe(a);

    // Carrera: findUnique no ve nada, create choca con la unicidad, se relee el ganador.
    let reads = 0;
    prisma.consentAcceptance = {
      findUnique: async () => (reads++ === 0 ? null : { id: 'ganador' }),
      create: async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      },
    };
    await expect(service.recordConsent(REQUEST_ID, { signerId: 'primero' }, 'tenant-a')).resolves.toEqual({ id: 'ganador' });
  });
});

describe('SignatureRequestsService.reject', () => {
  it('el firmante PENDIENTE rechaza: su fila y la solicitud pasan a RECHAZADO/RECHAZADA y se audita', async () => {
    const { service, signers, requests, collab, workflow } = makeService({ requests: [baseRequest({ order: 'PARALELO' })], signers: twoSigners() });
    const result = await service.reject(REQUEST_ID, { signerId: 'primero', reason: 'no procede' }, 'seguridata');
    expect(result.status).toBe('RECHAZADA');
    expect(signers.get('signer-primero')?.status).toBe('RECHAZADO');
    expect(requests.get(REQUEST_ID)?.status).toBe('RECHAZADA');
    expect(workflow.signalRejected).toHaveBeenCalledWith(REQUEST_ID, 'primero');
    expect(collab.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'REQUEST_REJECTED' }));
  });

  it('NO permite rechazar a quien ya FIRMÓ (409) y la solicitud sigue abierta', async () => {
    const { service, requests } = makeService({
      requests: [baseRequest({ status: 'EN_FIRMA' })],
      signers: [signerRow({ signerId: 'primero', status: 'FIRMADO', signedAt: new Date() }), signerRow({ signerId: 'segundo', sortOrder: 1 })],
    });
    await expect(service.reject(REQUEST_ID, { signerId: 'primero' }, 'seguridata')).rejects.toBeInstanceOf(ConflictException);
    expect(requests.get(REQUEST_ID)?.status).toBe('EN_FIRMA');
  });

  it('respeta el orden SECUENCIAL: el segundo no rechaza mientras el primero esté pendiente', async () => {
    const { service, requests } = makeService({ requests: [baseRequest()], signers: twoSigners() });
    await expect(service.reject(REQUEST_ID, { signerId: 'segundo' }, 'seguridata')).rejects.toBeInstanceOf(BadRequestException);
    expect(requests.get(REQUEST_ID)?.status).toBe('PENDIENTE');
  });

  it('un delegado puede rechazar la tarea delegada; el firmante original ya no', async () => {
    const mk = () =>
      makeService({
        requests: [baseRequest({ order: 'PARALELO' })],
        signers: [signerRow({ signerId: 'primero', delegatedTo: 'suplente' }), signerRow({ signerId: 'segundo', sortOrder: 1 })],
      });
    const a = mk();
    await expect(a.service.reject(REQUEST_ID, { signerId: 'primero' }, 'seguridata')).rejects.toBeInstanceOf(ForbiddenException);
    const b = mk();
    const result = await b.service.reject(REQUEST_ID, { signerId: 'suplente' }, 'seguridata');
    expect(result.status).toBe('RECHAZADA');
    expect(b.signers.get('signer-primero')?.status).toBe('RECHAZADO');
  });

  it('un no-firmante recibe 403', async () => {
    const { service } = makeService({ requests: [baseRequest()], signers: twoSigners() });
    await expect(service.reject(REQUEST_ID, { signerId: 'intruso' }, 'seguridata')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SignatureRequestsService.cancel', () => {
  it('cierra la solicitud Y los firmantes abiertos (sin huérfanos PENDIENTE/EN_PROCESO) y audita', async () => {
    const { service, signers, requests, collab, workflow } = makeService({
      requests: [baseRequest({ status: 'EN_FIRMA', order: 'PARALELO' })],
      signers: [
        signerRow({ signerId: 'primero', status: 'FIRMADO', signedAt: new Date() }),
        signerRow({ signerId: 'segundo', sortOrder: 1, status: 'EN_PROCESO' }),
        signerRow({ signerId: 'tercero', sortOrder: 2, pendingRef: 'p-1', pendingSince: new Date() }),
      ],
    });
    const result = await service.cancel(REQUEST_ID, { actorId: 'maria' }, 'seguridata');
    expect(result.status).toBe('RECHAZADA');
    expect(requests.get(REQUEST_ID)?.status).toBe('RECHAZADA');
    expect(signers.get('signer-primero')?.status).toBe('FIRMADO'); // lo firmado no se toca
    expect(signers.get('signer-segundo')?.status).toBe('RECHAZADO');
    expect(signers.get('signer-tercero')).toMatchObject({ status: 'RECHAZADO', pendingRef: null, pendingSince: null });
    expect(collab.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REQUEST_CANCELLED',
        actorId: 'maria',
        payload: expect.objectContaining({ cancelledSigners: ['segundo', 'tercero'] }),
      }),
    );
    expect(workflow.signalRejected).toHaveBeenCalledWith(REQUEST_ID, 'maria');
  });

  it('cancelar una solicitud ya cerrada no hace nada (sin auditoría ni señal)', async () => {
    const { service, collab, workflow } = makeService({
      requests: [baseRequest({ status: 'COMPLETADA' })],
      signers: [signerRow({ signerId: 'unico', status: 'FIRMADO', signedAt: new Date() })],
    });
    const result = await service.cancel(REQUEST_ID, { actorId: 'maria' }, 'seguridata');
    expect(result.status).toBe('COMPLETADA');
    expect(collab.audit).not.toHaveBeenCalled();
    expect(workflow.signalRejected).not.toHaveBeenCalled();
  });
});

describe('SignatureRequestsService.delegate', () => {
  const members = [
    { userId: 'suplente', name: 'Sara Suplente', email: 'sara@a.mx', tenantId: 'seguridata' },
    { userId: 'externo', name: 'Otro Tenant', email: 'x@b.mx', tenantId: 'tenant-b' },
  ];

  it('valida el destinatario contra TenantMembership: ajeno al tenant o inexistente => 400', async () => {
    const { service, signers } = makeService({ requests: [baseRequest()], signers: twoSigners(), members });
    await expect(
      service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'externo' }, 'seguridata'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'nadie' }, 'seguridata'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(signers.get('signer-primero')?.delegatedTo).toBeNull();
  });

  it('delega a un miembro (por correo se canoniza al userId) y reasigna las tareas', async () => {
    const { service, signers, workflow, collab } = makeService({ requests: [baseRequest()], signers: twoSigners(), members });
    await service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'SARA@a.mx' }, 'seguridata');
    expect(signers.get('signer-primero')).toMatchObject({ delegatedTo: 'suplente', delegatedToName: 'Sara Suplente' });
    expect(workflow.reassignForDelegation).toHaveBeenCalledWith(REQUEST_ID, 'primero', 'suplente');
    expect(collab.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELEGATED' }));
  });

  it('tras delegar, el firmante ORIGINAL ya no puede firmar (403) pero el delegado sí', async () => {
    const { service, signers } = makeService({ requests: [baseRequest()], signers: twoSigners(), members });
    await service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'suplente' }, 'seguridata');

    await expect(service.sign(REQUEST_ID, { signerId: 'primero', ...SIGN })).rejects.toBeInstanceOf(ForbiddenException);
    expect(signers.get('signer-primero')?.status).toBe('PENDIENTE');

    const result = await service.sign(REQUEST_ID, { signerId: 'suplente', ...SIGN });
    expect(result.status).toBe('FIRMADO');
    expect(signers.get('signer-primero')?.status).toBe('FIRMADO');
  });

  it('no se puede delegar a uno mismo, una firma ya firmada ni una solicitud cerrada', async () => {
    const a = makeService({ requests: [baseRequest()], signers: twoSigners(), members });
    await expect(a.service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'primero' }, 'seguridata')).rejects.toBeInstanceOf(BadRequestException);

    const b = makeService({
      requests: [baseRequest({ status: 'EN_FIRMA' })],
      signers: [signerRow({ signerId: 'primero', status: 'FIRMADO', signedAt: new Date() })],
      members,
    });
    await expect(b.service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'suplente' }, 'seguridata')).rejects.toBeInstanceOf(BadRequestException);

    const c = makeService({ requests: [baseRequest({ status: 'RECHAZADA' })], signers: twoSigners(), members });
    await expect(c.service.delegate(REQUEST_ID, { fromSignerId: 'primero', toSignerId: 'suplente' }, 'seguridata')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SignatureRequestsService.create — freeze y biometría', () => {
  const createBody = (over: Record<string, unknown> = {}) => ({
    documentId: DOCUMENT_ID,
    tenantId: 'seguridata',
    requestedBy: 'maria',
    methods: ['DIGITAL' as SignatureMethod],
    signers: [{ signerId: 'ana' }],
    ...over,
  });

  function makeCreate(caps: unknown[] = []) {
    const ctx = makeService({ requests: [], signers: [] });
    const created: Record<string, unknown>[] = [];
    const p = ctx.service as unknown as { prisma: Record<string, unknown> };
    Object.assign(p.prisma, {
      document: { findFirst: async () => ({ id: DOCUMENT_ID, tenantId: 'seguridata', caseId: 'case-1' }) },
      tenantMembership: { findMany: async () => [] },
      outOfOffice: { findMany: async () => [] },
      envelopeTemplate: { findFirst: async () => null },
      signatureRequest: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: 'sr-new', ...data, signers: [{ signerId: 'ana', name: null }] };
          created.push(row);
          return row;
        },
        findFirst: async () => created[0] ?? null,
      },
    });
    ctx.signing.capabilities.mockReturnValue(caps);
    return { ...ctx, created };
  }

  it('congela automáticamente el documento (con verificación de hash) ANTES de crear la solicitud', async () => {
    const { service, documents, created } = makeCreate();
    const order: string[] = [];
    documents.freeze.mockImplementation(async () => {
      order.push('freeze');
      return { locked: true };
    });
    const origFindFirst = (service as unknown as { prisma: { signatureRequest: { create: (a: never) => unknown } } }).prisma.signatureRequest.create;
    (service as unknown as { prisma: { signatureRequest: { create: (a: never) => unknown } } }).prisma.signatureRequest.create = (a: never) => {
      order.push('create');
      return origFindFirst(a);
    };
    await service.create(createBody());
    expect(documents.freeze).toHaveBeenCalledWith(DOCUMENT_ID, 'seguridata', 'maria', undefined);
    expect(order).toEqual(['freeze', 'create']);
    expect(created).toHaveLength(1);
  });

  it('si el freeze falla (p. ej. HASH_MISMATCH 409) no se crea la solicitud', async () => {
    const { service, documents, created } = makeCreate();
    documents.freeze.mockRejectedValue(new ConflictException({ error: 'HASH_MISMATCH' }));
    await expect(service.create(createBody())).rejects.toBeInstanceOf(ConflictException);
    expect(created).toHaveLength(0);
  });

  it('rechaza BIOMETRICA cuando no hay proveedor biométrico configurado', async () => {
    const { service, documents, created } = makeCreate([{ method: 'BIOMETRICA', configured: false }]);
    await expect(service.create(createBody({ methods: ['BIOMETRICA'] }))).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.freeze).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('acepta BIOMETRICA cuando el proveedor está configurado', async () => {
    const { service, created } = makeCreate([{ method: 'BIOMETRICA', configured: true }]);
    await service.create(createBody({ methods: ['BIOMETRICA'] }));
    expect(created).toHaveLength(1);
  });
});

describe('SignatureRequestsService.sign — métodos permitidos según el estado del PDF', () => {
  const visualRequest = (over: Partial<FakeRequestRow> = {}) =>
    baseRequest({ methods: ['DIGITAL', 'AUTOGRAFA', 'ACCEPT', 'PASSKEY'], ...over });
  const withDigitalFirst = () => [
    signerRow({ signerId: 'primero', status: 'FIRMADO', signedAt: new Date(), usedMethod: 'DIGITAL' }),
    signerRow({ signerId: 'segundo', sortOrder: 1 }),
  ];

  it('secuencial: tras la DIGITAL del 1, AUTOGRAFA del 2 da 409 temprano sin tocar storage ni adaptadores', async () => {
    const { service, signing, storage, signers } = makeService({
      requests: [visualRequest({ status: 'EN_FIRMA' })],
      signers: withDigitalFirst(),
    });
    const err = await service
      .sign(REQUEST_ID, { signerId: 'segundo', method: 'AUTOGRAFA', consentAccepted: true }, Buffer.from('png'))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      error: 'METHOD_NOT_ALLOWED_AFTER_SIGNATURE',
      allowedMethods: ['DIGITAL', 'ACCEPT', 'PASSKEY'],
    });
    expect(err.getResponse().message).toContain('DIGITAL, ACCEPT, PASSKEY');
    expect(signing.sign).not.toHaveBeenCalled();
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(signers.get('signer-segundo')?.status).toBe('PENDIENTE');
  });

  it('secuencial: tras la DIGITAL del 1, ACCEPT del 2 sigue permitido', async () => {
    const { service } = makeService({
      requests: [visualRequest({ status: 'EN_FIRMA' })],
      signers: withDigitalFirst(),
    });
    const out = await service.sign(REQUEST_ID, { signerId: 'segundo', method: 'ACCEPT', consentAccepted: true });
    expect(out.status).toBe('FIRMADO');
  });

  it('sin firma previa AUTOGRAFA sigue permitida', async () => {
    const { service, signing } = makeService({ requests: [visualRequest()], signers: twoSigners() });
    const out = await service.sign(
      REQUEST_ID,
      { signerId: 'primero', method: 'AUTOGRAFA', consentAccepted: true },
      Buffer.from('png'),
    );
    expect(out.status).toBe('FIRMADO');
    expect(signing.sign).toHaveBeenCalledTimes(1);
  });

  it('paralelo: AUTOGRAFA permitida antes de cualquier DIGITAL y bloqueada después', async () => {
    const before = makeService({ requests: [visualRequest({ order: 'PARALELO' })], signers: twoSigners() });
    await expect(
      before.service.sign(REQUEST_ID, { signerId: 'segundo', method: 'AUTOGRAFA', consentAccepted: true }, Buffer.from('png')),
    ).resolves.toMatchObject({ status: 'FIRMADO' });

    const after = makeService({
      requests: [visualRequest({ order: 'PARALELO', status: 'EN_FIRMA' })],
      signers: withDigitalFirst(),
    });
    await expect(
      after.service.sign(REQUEST_ID, { signerId: 'segundo', method: 'AUTOGRAFA', consentAccepted: true }, Buffer.from('png')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('getStatus expone allowedMethodsNow filtrado', async () => {
    const { service } = makeService({
      requests: [visualRequest({ status: 'EN_FIRMA' })],
      signers: withDigitalFirst(),
    });
    const status = await service.getStatus(REQUEST_ID);
    expect(status.allowedMethodsNow).toEqual(['DIGITAL', 'ACCEPT', 'PASSKEY']);
    expect(status.methods).toContain('AUTOGRAFA');
  });
});

describe('SignatureRequestsService.create — advertencia VISUAL_AFTER_DIGITAL_ORDER', () => {
  async function create(order: 'SECUENCIAL' | 'PARALELO', methods: SignatureMethod[]) {
    const m = makeService({ requests: [], signers: [] });
    const prisma = (m.service as unknown as { prisma: Record<string, unknown> }).prisma;
    prisma.document = {
      ...(prisma.document as object),
      findFirst: async () => ({ id: DOCUMENT_ID, tenantId: 'seguridata', caseId: 'case-1' }),
    };
    prisma.signatureRequest = {
      ...(prisma.signatureRequest as object),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        m.requests.set(REQUEST_ID, baseRequest({ methods: data.methods as SignatureMethod[], order: data.order as SigningOrder }));
        const row = signerRow({ signerId: 'a' });
        m.signers.set(row.id, row);
        return { id: REQUEST_ID, documentId: DOCUMENT_ID, tenantId: 'seguridata', order: data.order, signers: [row] };
      },
    };
    const priv = m.service as unknown as Record<string, unknown>;
    priv.resolveSigners = async () => [{ signerId: 'a' }];
    priv.applyOutOfOffice = async () => undefined;
    return m.service.create({
      documentId: DOCUMENT_ID,
      tenantId: 'seguridata',
      methods,
      order,
      signers: [{ signerId: 'a' }],
    });
  }

  it('SECUENCIAL con AUTOGRAFA + DIGITAL: crea y devuelve la advertencia', async () => {
    const out = await create('SECUENCIAL', ['DIGITAL', 'AUTOGRAFA']);
    expect(out.warnings).toEqual(['VISUAL_AFTER_DIGITAL_ORDER']);
  });

  it('PARALELO o sin mezcla: sin advertencias', async () => {
    expect((await create('PARALELO', ['DIGITAL', 'AUTOGRAFA'])).warnings).toEqual([]);
    expect((await create('SECUENCIAL', ['DIGITAL', 'ACCEPT'])).warnings).toEqual([]);
  });
});
