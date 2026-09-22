import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
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

/**
 * Fixture en memoria para una fila `SignatureRequest`, tal como la modela
 * prisma/schema.prisma (sin los campos que este servicio no toca).
 */
interface FakeRequestRow {
  id: string;
  documentId: string;
  methods: SignatureMethod[];
  order: SigningOrder;
  status: RequestStatus;
  requestedBy?: string;
  requestedByName?: string;
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
}

/**
 * Mock manual y ligero de PrismaService, cubriendo únicamente las llamadas
 * que `SignatureRequestsService.sign()` realmente hace: dos lecturas fuera
 * de transacción (para decidir si la firma es idempotente) y, dentro de
 * `$transaction`, una relectura + las dos escrituras. No requiere una base
 * de datos real: todo vive en dos Maps in-memory que la propia "tx" comparte
 * con la instancia de nivel superior (aceptable para un mock unitario, ya
 * que aquí no hay rollback real que simular).
 */
function createFakePrisma(seed: { requests: FakeRequestRow[]; signers: FakeSignerRow[] }) {
  const requests = new Map(seed.requests.map((r) => [r.id, { ...r }]));
  const signers = new Map(seed.signers.map((s) => [s.id, { ...s }]));

  function hydrate(req: FakeRequestRow, includeSigners: boolean) {
    const document = {
      id: req.documentId,
      hash: 'abc',
      objectKey: 'documents/2026-01-01/obj-1.pdf',
      enc: { v: 1, alg: 'AES-256-GCM', iv: 'x', tag: 'x', dek: { wrapped: 'x', iv: 'x', tag: 'x' } },
      filename: 'contrato.pdf',
      caseId: 'case-1',
    };
    if (!includeSigners) return { ...req, document };
    const requestSigners = [...signers.values()]
      .filter((s) => s.signatureRequestId === req.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({ ...s }));
    return { ...req, signers: requestSigners, document };
  }

  const findReq = ({
    where,
    include,
  }: {
    where: { id: string };
    include?: { signers?: unknown };
  }) => {
    const req = requests.get(where.id);
    if (!req) return null;
    return hydrate(req, Boolean(include?.signers));
  };

  const api = {
    signatureRequest: {
      findUnique: async (args: { where: { id: string }; include?: { signers?: unknown } }) =>
        findReq(args),
      findFirst: async (args: { where: { id: string }; include?: { signers?: unknown } }) =>
        findReq(args),
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
        return hydrate(req, Boolean(include?.signers));
      },
    },
    signer: {
      findFirst: async ({
        where,
      }: {
        where: { signatureRequestId: string; signerId: string };
      }) => {
        for (const s of signers.values()) {
          if (
            s.signatureRequestId === where.signatureRequestId &&
            s.signerId === where.signerId
          ) {
            return { ...s };
          }
        }
        return null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeSignerRow>;
      }) => {
        const s = signers.get(where.id);
        if (!s) throw new Error(`signer ${where.id} no existe en el fixture`);
        Object.assign(s, data);
        return { ...s };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: { not?: string } };
        data: Partial<FakeSignerRow>;
      }) => {
        const s = signers.get(where.id);
        if (!s) return { count: 0 };
        if (where.status?.not && s.status === where.status.not) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      },
    },
    // El servicio real hace `this.prisma.$transaction(async (tx) => {...})`.
    // Como el fixture es un mapa en memoria compartido (sin motor SQL real
    // detrás), basta con invocar el callback pasándole la misma `api` como
    // `tx` — no hay aislamiento de transacción que simular para este test.
    $transaction: async <T>(fn: (tx: typeof api) => Promise<T>): Promise<T> => fn(api),
    consentAcceptance: {
      findUnique: async () => ({ id: 'consent-1', textVersion: '1.1' }),
      upsert: async ({ create }: { create: Record<string, unknown> }) => create,
    },
    signatureField: {
      findFirst: async () => null,
    },
    document: {
      findUnique: async () => ({
        id: DOCUMENT_ID,
        hash: 'abc',
        objectKey: 'documents/2026-01-01/obj-1.pdf',
        enc: { v: 1, alg: 'AES-256-GCM', iv: 'x', tag: 'x', dek: { wrapped: 'x', iv: 'x', tag: 'x' } },
        filename: 'contrato.pdf',
        caseId: 'case-1',
      }),
      update: async () => ({}),
    },
  };

  return { prisma: api as unknown as PrismaService, requests, signers };
}

function makeService(seed: { requests: FakeRequestRow[]; signers: FakeSignerRow[] }) {
  const { prisma, requests, signers } = createFakePrisma(seed);
  const realtime = { notifyDocumentEvent: vi.fn() } as unknown as RealtimeGateway;
  const evidence = { generateForRequest: vi.fn().mockResolvedValue(undefined) } as unknown as EvidenceService;
  const workflow = {
    startInstance: vi.fn().mockResolvedValue({ id: 'wf' }),
    signalSigned: vi.fn().mockResolvedValue(undefined),
    signalRejected: vi.fn().mockResolvedValue(undefined),
  };
  const signing = {
    sign: vi.fn().mockResolvedValue({ algorithm: 'HMAC-SHA256', signatureHash: 'x', provider: 'test' }),
    capabilities: vi.fn().mockReturnValue([]),
  };
  const stamp = { stampAutograph: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 stamped')) };
  const storage = {
    getObject: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    putObject: vi.fn().mockResolvedValue({
      objectKey: 'documents/2026-01-01/obj-2.pdf',
      sha256: 'def',
      sizeBytes: 15,
      enc: { v: 1, alg: 'AES-256-GCM', iv: 'y', tag: 'y', dek: { wrapped: 'y', iv: 'y', tag: 'y' } },
    }),
  };
  const collab = { notify: vi.fn(), audit: vi.fn() };
  const mail = {
    sendInvites: vi.fn().mockResolvedValue(undefined),
    sendCompleted: vi.fn().mockResolvedValue(undefined),
    sendReminder: vi.fn().mockResolvedValue(undefined),
  };
  const policyService = {
    resolve: vi.fn().mockResolvedValue({ version: 0, source: 'default', allowedMethods: ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA'] }),
    enforce: vi.fn((_p: unknown, r: { order?: string; slaHours?: number }) => ({
      order: r.order ?? 'SECUENCIAL',
      slaHours: r.slaHours ?? 72,
    })),
  };

  const service = new SignatureRequestsService(
    prisma,
    realtime,
    evidence,
    workflow as never,
    signing as never,
    stamp as never,
    storage as never,
    collab as never,
    mail as never,
    policyService as never,
  );
  return { service, requests, signers, realtime, evidence };
}

const REQUEST_ID = 'req-1';
const DOCUMENT_ID = 'doc-1';

function baseRequest(overrides: Partial<FakeRequestRow> = {}): FakeRequestRow {
  return {
    id: REQUEST_ID,
    documentId: DOCUMENT_ID,
    methods: ['DIGITAL'],
    order: 'SECUENCIAL',
    status: 'PENDIENTE',
    requestedBy: 'maria',
    requestedByName: 'María González',
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
    ...overrides,
  };
}

describe('SignatureRequestsService.sign — orden secuencial', () => {
  it('rechaza la firma de un firmante posterior mientras haya uno anterior PENDIENTE', async () => {
    const { service, realtime } = makeService({
      requests: [baseRequest({ order: 'SECUENCIAL' })],
      signers: [
        signerRow({ signerId: 'primero', sortOrder: 0, status: 'PENDIENTE' }),
        signerRow({ signerId: 'segundo', sortOrder: 1, status: 'PENDIENTE' }),
      ],
    });

    await expect(
      service.sign(REQUEST_ID, { signerId: 'segundo', method: 'DIGITAL', consentAccepted: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
  });

  it('permite firmar al primer firmante pendiente en el orden y avanza el estado a EN_FIRMA', async () => {
    const { service, signers, realtime } = makeService({
      requests: [baseRequest({ order: 'SECUENCIAL' })],
      signers: [
        signerRow({ signerId: 'primero', sortOrder: 0, status: 'PENDIENTE' }),
        signerRow({ signerId: 'segundo', sortOrder: 1, status: 'PENDIENTE' }),
      ],
    });

    const result = await service.sign(REQUEST_ID, { signerId: 'primero', method: 'DIGITAL', consentAccepted: true });

    expect(result.status).toBe('EN_FIRMA');
    expect(signers.get('signer-primero')?.status).toBe('FIRMADO');
    expect(realtime.notifyDocumentEvent).toHaveBeenCalledTimes(1);
    expect(realtime.notifyDocumentEvent).toHaveBeenCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({ type: 'SIGNATURE_APPLIED', actorId: 'primero' }),
    );
  });

  it('no exige orden alguno cuando la solicitud es PARALELO', async () => {
    const { service } = makeService({
      requests: [baseRequest({ order: 'PARALELO' })],
      signers: [
        signerRow({ signerId: 'primero', sortOrder: 0, status: 'PENDIENTE' }),
        signerRow({ signerId: 'segundo', sortOrder: 1, status: 'PENDIENTE' }),
      ],
    });

    const result = await service.sign(REQUEST_ID, { signerId: 'segundo', method: 'DIGITAL', consentAccepted: true });
    expect(result.status).toBe('EN_FIRMA');
  });
});

describe('SignatureRequestsService.sign — idempotencia', () => {
  it('reintentar la firma de un firmante que ya firmó no lo vuelve a marcar ni notifica de nuevo', async () => {
    const { service, signers, realtime, evidence } = makeService({
      requests: [baseRequest({ status: 'EN_FIRMA' })],
      signers: [
        signerRow({
          signerId: 'primero',
          sortOrder: 0,
          status: 'FIRMADO',
          signedAt: new Date('2026-01-01T10:00:00Z'),
          usedMethod: 'DIGITAL',
        }),
        signerRow({ signerId: 'segundo', sortOrder: 1, status: 'PENDIENTE' }),
      ],
    });

    const result = await service.sign(REQUEST_ID, { signerId: 'primero', method: 'DIGITAL', consentAccepted: true });

    expect(result.status).toBe('EN_FIRMA');
    // La fecha de firma original se conserva: no se sobrescribió el registro.
    expect(signers.get('signer-primero')?.signedAt).toEqual(new Date('2026-01-01T10:00:00Z'));
    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
    expect(evidence.generateForRequest).not.toHaveBeenCalled();
  });

  it('actuar sobre una solicitud ya COMPLETADA no cambia nada ni vuelve a generar evidencia', async () => {
    const { service, requests, realtime, evidence } = makeService({
      requests: [baseRequest({ status: 'COMPLETADA' })],
      signers: [
        signerRow({
          signerId: 'primero',
          sortOrder: 0,
          status: 'FIRMADO',
          signedAt: new Date('2026-01-01T10:00:00Z'),
          usedMethod: 'DIGITAL',
        }),
      ],
    });

    const result = await service.sign(REQUEST_ID, { signerId: 'primero', method: 'DIGITAL', consentAccepted: true });

    expect(result.status).toBe('COMPLETADA');
    expect(requests.get(REQUEST_ID)?.status).toBe('COMPLETADA');
    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
    expect(evidence.generateForRequest).not.toHaveBeenCalled();
  });

  it('actuar sobre una solicitud RECHAZADA tampoco reabre el flujo ni notifica', async () => {
    const { service, realtime } = makeService({
      requests: [baseRequest({ status: 'RECHAZADA' })],
      signers: [signerRow({ signerId: 'primero', sortOrder: 0, status: 'RECHAZADO' })],
    });

    const result = await service.sign(REQUEST_ID, { signerId: 'primero', method: 'DIGITAL', consentAccepted: true });

    expect(result.status).toBe('RECHAZADA');
    expect(realtime.notifyDocumentEvent).not.toHaveBeenCalled();
  });

  it('firmar al último firmante pendiente completa la solicitud y genera el manifiesto de evidencia una sola vez', async () => {
    const { service, realtime, evidence } = makeService({
      requests: [baseRequest({ order: 'SECUENCIAL' })],
      signers: [
        signerRow({ signerId: 'unico', sortOrder: 0, status: 'PENDIENTE' }),
      ],
    });

    const result = await service.sign(REQUEST_ID, { signerId: 'unico', method: 'DIGITAL' });

    expect(result.status).toBe('COMPLETADA');
    expect(realtime.notifyDocumentEvent).toHaveBeenCalledTimes(2);
    expect(realtime.notifyDocumentEvent).toHaveBeenNthCalledWith(
      1,
      DOCUMENT_ID,
      expect.objectContaining({ type: 'SIGNATURE_APPLIED' }),
    );
    expect(realtime.notifyDocumentEvent).toHaveBeenNthCalledWith(
      2,
      DOCUMENT_ID,
      expect.objectContaining({ type: 'REQUEST_COMPLETED' }),
    );
    expect(evidence.generateForRequest).toHaveBeenCalledTimes(1);
    expect(evidence.generateForRequest).toHaveBeenCalledWith(REQUEST_ID);
  });
});

describe('SignatureRequestsService.sign — validaciones adicionales', () => {
  it('rechaza un método no autorizado para la solicitud', async () => {
    const { service } = makeService({
      requests: [baseRequest({ methods: ['DIGITAL'] })],
      signers: [signerRow({ signerId: 'unico', sortOrder: 0, status: 'PENDIENTE' })],
    });

    await expect(
      service.sign(REQUEST_ID, { signerId: 'unico', method: 'BIOMETRICA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SignatureRequestsService.sign — setup del mock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el mock de prisma no requiere una base de datos real para operar', async () => {
    const { service } = makeService({
      requests: [baseRequest()],
      signers: [signerRow({ signerId: 'unico', sortOrder: 0 })],
    });
    const found = await service.getOrThrow(REQUEST_ID);
    expect(found.id).toBe(REQUEST_ID);
  });
});
