/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from './onboarding.service';

const JPG = Buffer.from('jpg-bytes');

function make(row: Record<string, unknown> = {}) {
  const current = {
    id: 'ob1',
    tenantId: 'acme',
    status: 'DATOS',
    biometricConsentAt: new Date(),
    ineFront: null,
    ineBack: null,
    ineHash: null,
    ineOcr: null,
    selfie: null,
    ...row,
  };
  const prisma = {
    onboardingCase: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async ({ where }: any) => (where.tenantId === current.tenantId ? current : null)),
      create: vi.fn(async ({ data }: any) => ({ id: 'ob1', ...data })),
      update: vi.fn(async ({ data }: any) => ({ ...current, ...data })),
    },
  };
  const storage = {
    putObject: vi.fn(async ({ prefix, filename }: any) => ({
      objectKey: `${prefix}/2026-10-01/uuid-${filename}`,
      sha256: 'h'.repeat(64),
      sizeBytes: 3,
      enc: {},
    })),
    getObject: vi.fn(async () => JPG),
  };
  const collab = { audit: vi.fn(async () => undefined) };
  const ocr = { recognizeIne: vi.fn(async () => ({ engine: 't', fields: {} })) };
  const biometrics = { analyze: vi.fn(async () => ({ livenessOk: true })), kind: 'noop' };
  const svc = new OnboardingService(
    prisma as any,
    collab as any,
    {} as any,
    storage as any,
    { emit: vi.fn() } as any,
    ocr as any,
    {} as any,
    biometrics as any,
  );
  return { svc, prisma, storage, ocr, biometrics };
}

const ACTOR = { actorId: 'u1' };

describe('OnboardingService: sin tenant por defecto', () => {
  it('list filtra por el tenant recibido', async () => {
    const { svc, prisma } = make();
    await svc.list('acme');
    expect((prisma.onboardingCase.findMany.mock.calls[0] as any)[0].where).toEqual({ tenantId: 'acme' });
  });

  it('create sin tenantId se rechaza (antes caía en "seguridata")', async () => {
    const { svc, prisma } = make();
    await expect(
      svc.create({ fullName: 'Ana', email: 'a@x.mx', requestedBy: 'u1', biometricConsent: true } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.onboardingCase.create).not.toHaveBeenCalled();
  });

  it('create guarda el tenant recibido', async () => {
    const { svc, prisma } = make();
    await svc.create({ tenantId: 'acme', fullName: 'Ana', email: 'a@x.mx', requestedBy: 'u1', biometricConsent: true });
    expect((prisma.onboardingCase.create.mock.calls[0] as any)[0].data.tenantId).toBe('acme');
  });
});

describe('OnboardingService: claves de storage con tenant', () => {
  it('INE y selfie se guardan bajo onboarding/<tenant>/...', async () => {
    const { svc, storage, prisma } = make();
    await svc.attachIne('ob1', { front: JPG, back: JPG, tenantId: 'acme', ...ACTOR });
    const prefixes = storage.putObject.mock.calls.map((c: any) => c[0].prefix);
    expect(prefixes).toEqual(['onboarding/acme/ine', 'onboarding/acme/ine']);
    const saved = (prisma.onboardingCase.update.mock.calls[0] as any)[0].data;
    expect(saved.ineFront.key).toMatch(/^onboarding\/acme\/ine\//);

    await svc.captureLiveness('ob1', { selfie: Buffer.alloc(3000), tenantId: 'acme', ...ACTOR } as any);
    expect(storage.putObject.mock.calls.at(-1)![0].prefix).toBe('onboarding/acme/selfie');
  });

  it('compatibilidad: una INE guardada con la clave ANTIGUA (onboarding/ine/...) se sigue leyendo', async () => {
    const legacy = { key: 'onboarding/ine/2026-09-01/uuid-ob1-frente.jpg', sha256: 'h', size: 3, enc: {} };
    const { svc, storage } = make({ ineFront: legacy, ineBack: { ...legacy, key: 'onboarding/ine/2026-09-01/uuid-ob1-reverso.jpg' } });
    // Sólo llega el reverso nuevo: el frente viejo se lee del storage para el OCR.
    await svc.attachIne('ob1', { back: JPG, tenantId: 'acme', ...ACTOR });
    expect(storage.getObject).toHaveBeenCalledWith(legacy.key, legacy.enc);
  });

  it('defensa en profundidad: una referencia con clave de OTRO tenant no se lee', async () => {
    const foreign = { key: 'onboarding/otro/ine/2026-09-01/uuid-x.jpg', sha256: 'h', size: 3, enc: {} };
    const { svc, storage, ocr } = make({ ineFront: foreign });
    await svc.attachIne('ob1', { back: JPG, tenantId: 'acme', ...ACTOR });
    expect(storage.getObject).not.toHaveBeenCalled();
    // El OCR registra el error en vez de procesar el archivo ajeno.
    expect(ocr.recognizeIne).not.toHaveBeenCalled();
  });

  it('otro tenant no puede operar el alta (404)', async () => {
    const { svc } = make();
    await expect(svc.attachIne('ob1', { front: JPG, tenantId: 'otro', ...ACTOR })).rejects.toBeInstanceOf(NotFoundException);
  });
});
