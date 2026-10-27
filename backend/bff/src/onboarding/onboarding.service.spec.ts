/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from './onboarding.service';

const JPG = Buffer.from('jpg-bytes');

function make(row: Record<string, unknown> = {}, accounts?: any, taken: string[] = []) {
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
      count: vi.fn(async ({ where }: any) => (taken.includes(where?.username?.equals) ? 1 : 0)),
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
    accounts,
  );
  return { svc, prisma, storage, ocr, biometrics, collab };
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
    // Hermética: un .env local con STORAGE_REQUIRE_TENANT_AAD=true (lo carga @prisma/client) no debe cambiar el resultado.
    vi.stubEnv('STORAGE_REQUIRE_TENANT_AAD', 'false');
    const legacy = { key: 'onboarding/ine/2026-09-01/uuid-ob1-frente.jpg', sha256: 'h', size: 3, enc: {} };
    const { svc, storage } = make({ ineFront: legacy, ineBack: { ...legacy, key: 'onboarding/ine/2026-09-01/uuid-ob1-reverso.jpg' } });
    // Sólo llega el reverso nuevo: el frente viejo se lee del storage para el OCR.
    await svc.attachIne('ob1', { back: JPG, tenantId: 'acme', ...ACTOR });
    expect(storage.getObject).toHaveBeenCalledWith(legacy.key, legacy.enc, 'acme');
    vi.unstubAllEnvs();
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

describe('OnboardingService: usuario de acceso del alta', () => {
  const maya = {
    tenantId: 'acme',
    fullName: 'Maya Pamela Perez Flores',
    givenNames: 'Maya Pamela',
    lastName: 'Perez',
    secondLastName: 'Flores',
    email: 'Maya@X.mx',
    requestedBy: 'u1',
    biometricConsent: true,
  };
  const keycloak = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    usernameExists: vi.fn(async () => false),
    createUser: vi.fn(async () => ({ id: 'kc-1' })),
    disableUser: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    ...over,
  });

  it('crea la cuenta con el usuario calculado y lo guarda junto al alta', async () => {
    const kc = keycloak();
    const { svc, prisma } = make({}, kc);
    const view: any = await svc.create(maya);
    expect(kc.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'mperez', email: 'maya@x.mx', firstName: 'Maya Pamela', lastName: 'Perez Flores', tenant: 'acme' }),
    );
    const saved = (prisma.onboardingCase.create.mock.calls[0] as any)[0].data;
    expect(saved).toMatchObject({ username: 'mperez', accountId: 'kc-1' });
    expect(view.username).toBe('mperez');
    expect(view).not.toHaveProperty('accountId');
  });

  it('si el usuario ya existe en Keycloak usa la inicial del segundo nombre', async () => {
    const kc = keycloak({ usernameExists: vi.fn(async (u: string) => u === 'mperez') });
    const { svc } = make({}, kc);
    expect(((await svc.create(maya)) as any).username).toBe('pperez');
  });

  it('si el usuario ya está en otra alta usa el siguiente candidato', async () => {
    const { svc } = make({}, undefined, ['mperez']);
    expect(((await svc.create(maya)) as any).username).toBe('pperez');
  });

  it('pierde la carrera en Keycloak (409 por usuario): reintenta con el siguiente', async () => {
    const { AccountConflictError } = await import('./keycloak-admin.service');
    const createUser = vi
      .fn()
      .mockRejectedValueOnce(new AccountConflictError('username'))
      .mockResolvedValueOnce({ id: 'kc-2' });
    const { svc } = make({}, keycloak({ createUser }));
    expect(((await svc.create(maya)) as any).username).toBe('pperez');
  });

  it('correo ya registrado en Keycloak: 409 claro y sin alta', async () => {
    const { AccountConflictError } = await import('./keycloak-admin.service');
    const createUser = vi.fn(async () => {
      throw new AccountConflictError('email');
    });
    const { svc, prisma } = make({}, keycloak({ createUser }));
    await expect(svc.create(maya)).rejects.toMatchObject({ response: { error: 'ACCOUNT_EMAIL_EXISTS' } });
    expect(prisma.onboardingCase.create).not.toHaveBeenCalled();
  });

  it('si el alta no se guarda, la cuenta recién creada se borra', async () => {
    const kc = keycloak();
    const { svc, prisma } = make({}, kc);
    prisma.onboardingCase.create.mockRejectedValueOnce(new Error('db'));
    await expect(svc.create(maya)).rejects.toThrow('db');
    expect(kc.deleteUser).toHaveBeenCalledWith('kc-1');
  });

  it('sin creación de cuentas configurada: solo reserva el usuario', async () => {
    const kc = keycloak({ enabled: false });
    const { svc, prisma } = make({}, kc);
    await svc.create(maya);
    expect(kc.createUser).not.toHaveBeenCalled();
    expect((prisma.onboardingCase.create.mock.calls[0] as any)[0].data).toMatchObject({ username: 'mperez', accountId: null });
  });

  it('rechazar el alta deshabilita la cuenta y lo audita', async () => {
    const kc = keycloak();
    const { svc, collab } = make({ accountId: 'kc-1', username: 'mperez' }, kc);
    await svc.reject('ob1', { actorId: 'rh', tenantId: 'acme', notes: 'no procede' });
    expect(kc.disableUser).toHaveBeenCalledWith('kc-1');
    expect(collab.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCOUNT_DISABLED' }));
  });

  it('si Keycloak no responde al rechazar, el rechazo igual se guarda', async () => {
    const disableUser = vi.fn(async () => {
      throw new Error('caído');
    });
    const { svc, prisma } = make({ accountId: 'kc-1', username: 'mperez' }, keycloak({ disableUser }));
    await expect(svc.reject('ob1', { actorId: 'rh', tenantId: 'acme' })).resolves.toBeTruthy();
    expect((prisma.onboardingCase.update.mock.calls[0] as any)[0].data.status).toBe('RECHAZADO');
  });
});
