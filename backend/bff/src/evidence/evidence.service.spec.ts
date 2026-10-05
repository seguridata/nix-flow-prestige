import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { EvidenceService } from './evidence.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { ManifestSigner } from './manifest-signer';

const MANIFEST = {
  id: 'em-1',
  manifestId: 'man-1',
  signatureRequestId: 'sr-1',
  documentId: 'doc-1',
  documentVersion: 1,
  tenantId: 'seguridata',
  originalHash: 'a'.repeat(64),
  presentedHash: 'a'.repeat(64),
  signedHash: 'b'.repeat(64),
  packageHash: 'c'.repeat(64),
  signingOrder: 'SECUENCIAL',
  chainOfCustody: [],
  consentRecords: [],
  signatures: [],
  timestampProvider: 'none',
  timestampIssuedAt: new Date('2026-01-01T00:00:00.000Z'),
  timestampTokenHash: null,
  timestampToken: null,
  manifestHash: null,
  manifestSignature: null,
  manifestSigningKeyId: null,
  signaturePolicy: null,
  validationConclusion: 'VALIDO',
  validationReasons: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeService(events: Record<string, unknown>[]) {
  const prisma = {
    evidenceManifest: { findUnique: async () => MANIFEST },
    document: {
      findUnique: async () => ({
        objectKey: 'k1',
        enc: {},
        hash: MANIFEST.originalHash,
        filename: 'contrato.pdf',
        presentedObjectKey: null,
        presentedEnc: null,
      }),
    },
    processAuditEvent: {
      findMany: async () => events,
    },
  } as unknown as PrismaService;

  const storage = {
    getObject: async () => Buffer.from('%PDF-1.4 contenido'),
  } as unknown as StorageService;

  const manifestSigner = { publicKeyPem: null } as unknown as ManifestSigner;

  return new EvidenceService(prisma, manifestSigner, storage, undefined as never, undefined as never);
}

describe('EvidenceService.buildDossier', () => {
  it('incluye events.jsonl con la bitácora encadenada, en el mismo orden que la consulta', async () => {
    const events = [
      {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        action: 'DOC_UPLOADED',
        actorId: 'ana',
        actorName: 'Ana',
        prevHash: null,
        hash: 'h1',
        payload: { sha256: 'x' },
      },
      {
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        action: 'DOC_FROZEN',
        actorId: 'ana',
        actorName: 'Ana',
        prevHash: 'h1',
        hash: 'h2',
        payload: null,
      },
    ];
    const svc = makeService(events);
    const { files } = await svc.buildDossier('man-1', 'seguridata');

    const jsonl = files.find((f) => f.path === 'events.jsonl');
    expect(jsonl).toBeDefined();
    const lines = (jsonl!.content as string).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ action: 'DOC_UPLOADED', hash: 'h1' });
    expect(lines[1]).toMatchObject({ action: 'DOC_FROZEN', prevHash: 'h1', hash: 'h2' });
  });

  it('pack.sha256 lista el sha256 real de cada archivo anterior del expediente', async () => {
    const svc = makeService([]);
    const { files } = await svc.buildDossier('man-1', 'seguridata');

    const packEntry = files.find((f) => f.path === 'pack.sha256');
    expect(packEntry).toBeDefined();
    const lines = (packEntry!.content as string).trim().split('\n');
    const filesBeforePack = files.filter((f) => f.path !== 'pack.sha256');
    expect(lines).toHaveLength(filesBeforePack.length);

    for (const f of filesBeforePack) {
      const expectedHash = createHash('sha256').update(f.content).digest('hex');
      expect(lines).toContain(`${expectedHash}  ${f.path}`);
    }
  });

  it('document.sha256 coincide con el hash del documento congelado', async () => {
    const svc = makeService([]);
    const { files } = await svc.buildDossier('man-1', 'seguridata');
    const sha = files.find((f) => f.path === 'document.sha256');
    expect(sha!.content).toBe(`${MANIFEST.originalHash}  document.pdf\n`);
  });
});

describe('EvidenceService.verify (checks coherentes con valid)', () => {
  it('solicitud DIGITAL: presentado distinto del canónico → valid, sin mismatches y ningún check en false', async () => {
    const presented = 'd'.repeat(64);
    const canonical = 'a'.repeat(64);
    const probe = new EvidenceService({} as never, {} as never, {} as never, undefined as never, undefined as never);
    const signedHash = (probe as unknown as { hashSignedSet: (s: unknown[]) => string }).hashSignedSet([]);
    const packageHash = createHash('sha256').update(`man-1${signedHash}doc-1`).digest('hex');
    const manifest = {
      ...MANIFEST,
      originalHash: canonical,
      presentedHash: presented,
      signedHash,
      packageHash,
    };
    const prisma = {
      evidenceManifest: { findUnique: async () => manifest },
      signatureRequest: {
        findUnique: async () => ({
          id: 'sr-1',
          signers: [],
          document: { hash: canonical, presentedHash: presented },
        }),
      },
      signatureEventTimestamp: { findFirst: async () => null },
    } as unknown as PrismaService;
    const auditChain = { verify: async () => ({ ok: true }) };
    const svc = new EvidenceService(
      prisma,
      { publicKeyPem: null } as unknown as ManifestSigner,
      {} as unknown as StorageService,
      undefined as never,
      auditChain as never,
    );

    const r = await svc.verify('man-1');
    expect(r.mismatches).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.checks.documentHash).toBe(true);
    expect(r.checks.presentedHash).toBe(true);
    expect(Object.values(r.checks).includes(false)).toBe(false);
  });
});
