/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { StorageService, assertTenantKey } from './storage.service';
import { encryptObject } from './object-crypto';

function make(send?: (...a: any[]) => Promise<unknown>) {
  const svc = new StorageService();
  if (send) (svc as any).client = { send };
  return svc;
}

describe('StorageService.ping', () => {
  const prev = process.env.S3_ENDPOINT;
  afterEach(() => {
    if (prev === undefined) delete process.env.S3_ENDPOINT;
    else process.env.S3_ENDPOINT = prev;
  });

  it('sin configurar devuelve false', async () => {
    delete process.env.S3_ENDPOINT;
    expect(await make().ping()).toBe(false);
  });

  it('bucket accesible devuelve true', async () => {
    expect(await make(vi.fn().mockResolvedValue({})).ping()).toBe(true);
  });

  it('error del cliente devuelve false sin lanzar', async () => {
    expect(await make(vi.fn().mockRejectedValue(new Error('boom'))).ping()).toBe(false);
  });

  it('timeout devuelve false', async () => {
    const hang = vi.fn(() => new Promise(() => {}));
    expect(await make(hang).ping(50)).toBe(false);
  });
});

describe('assertTenantKey (defensa en profundidad por tenant)', () => {
  it('acepta las claves con el tenant en la posición esperada de cada prefijo', () => {
    for (const key of [
      'documents/acme/case-1/2026-10-01/uuid-contrato.pdf',
      'templates/acme/2026-10-01/uuid-formato.pdf',
      'evidence/acme/2026-10-01/uuid-trazo.png',
      'presented/acme/2026-10-01/uuid-firmado.pdf',
      'onboarding/acme/ine/2026-10-01/uuid-frente.jpg',
    ]) {
      expect(() => assertTenantKey('acme', key)).not.toThrow();
    }
  });

  it('rechaza con 404 la clave de OTRO tenant y deja el error en el log', () => {
    const err = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(() => assertTenantKey('acme', 'documents/otro/case-1/2026-10-01/uuid-x.pdf')).toThrow(NotFoundException);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('documents/otro/case-1'));
    err.mockRestore();
  });

  it('rechaza prefijos desconocidos, el tenant en otra posición, recorridos de ruta y tenant vacío', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    for (const [tenant, key] of [
      ['acme', 'pgtest/acme/x'],
      ['acme', 'otro/documents/acme/x'],
      ['acme', 'documents/acme/../otro/x'],
      ['acme', 'documents//acme/x'],
      ['acme', 'documents/acme'],
      ['', 'documents//x/y'],
      ['', 'documents/acme/c/x'],
    ] as const) {
      expect(() => assertTenantKey(tenant, key), `${tenant} ${key}`).toThrow(NotFoundException);
    }
    vi.restoreAllMocks();
  });

  it('NO bloquea claves antiguas sin tenant (documentos previos, backfill, INE/selfie viejas): sólo avisa', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const key of [
      'documents/2026-08-20/uuid-contrato.pdf',
      'legacy/pendiente-de-backfill/doc-1',
      'onboarding/ine/2026-09-01/uuid-frente.jpg',
      'onboarding/selfie/2026-09-01/uuid-selfie.jpg',
    ]) {
      expect(() => assertTenantKey('acme', key)).not.toThrow();
    }
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});

describe('StorageService credenciales S3', () => {
  const keys = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'NODE_ENV'] as const;
  const saved: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  function setEnv(extra: Record<string, string | undefined>) {
    for (const k of keys) saved[k] = process.env[k];
    process.env.S3_ENDPOINT = 'http://s3.local:9000';
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  it('en producción exige credenciales definidas y distintas de las de desarrollo', () => {
    setEnv({ NODE_ENV: 'production', S3_ACCESS_KEY: undefined, S3_SECRET_KEY: undefined });
    expect(() => new StorageService()).toThrow(/S3_ACCESS_KEY/);
    setEnv({ NODE_ENV: 'production', S3_ACCESS_KEY: 'prestige', S3_SECRET_KEY: 'prestige-minio' });
    expect(() => new StorageService()).toThrow(/S3_ACCESS_KEY/);
    setEnv({ NODE_ENV: 'production', S3_ACCESS_KEY: 'AKIAREAL', S3_SECRET_KEY: 'secreto-real' });
    expect(new StorageService().enabled).toBe(true);
  });

  it('en desarrollo conserva los defaults', () => {
    setEnv({ NODE_ENV: 'development', S3_ACCESS_KEY: undefined, S3_SECRET_KEY: undefined });
    expect(new StorageService().enabled).toBe(true);
  });
});

describe('StorageService putObject/getObject/deleteObject con tenant', () => {
  const prevKey = process.env.STORAGE_MASTER_KEY;
  const prevEnv = { NODE_ENV: process.env.NODE_ENV, S3_ENDPOINT: process.env.S3_ENDPOINT };
  beforeEach(() => {
    // Aislado de otros describe que dejan NODE_ENV=production o S3_ENDPOINT sin restaurar.
    process.env.NODE_ENV = 'test';
    delete process.env.S3_ENDPOINT;
    process.env.STORAGE_MASTER_KEY = randomBytes(32).toString('base64');
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevKey === undefined) delete process.env.STORAGE_MASTER_KEY;
    else process.env.STORAGE_MASTER_KEY = prevKey;
  });

  /** Fake de S3 en memoria: guarda el ciphertext por clave. */
  function memoryS3() {
    const store = new Map<string, Buffer>();
    const send = vi.fn(async (cmd: any) => {
      const name = cmd.constructor.name;
      const { Key, Body } = cmd.input;
      if (name === 'PutObjectCommand') store.set(Key, Buffer.from(Body));
      if (name === 'DeleteObjectCommand') store.delete(Key);
      if (name === 'GetObjectCommand') {
        const buf = store.get(Key);
        return { Body: { transformToByteArray: async () => new Uint8Array(buf!) } };
      }
      return {};
    });
    return { store, send };
  }

  it('los objetos nuevos se escriben con AAD de tenant y el tenant A no descifra el de B', async () => {
    const { send } = memoryS3();
    const svc = make(send);
    const stored = await svc.putObject({
      prefix: 'documents/acme',
      filename: 'a.pdf',
      bytes: Buffer.from('contenido de acme'),
      contentType: 'application/pdf',
      tenantId: 'acme',
    });
    expect(stored.enc.aad).toBe('tenant');
    expect((await svc.getObject(stored.objectKey, stored.enc, 'acme')).toString()).toBe('contenido de acme');
    // Misma clave de objeto presentada por otro tenant: assertTenantKey lo corta.
    await expect(svc.getObject(stored.objectKey, stored.enc, 'otro')).rejects.toThrow(NotFoundException);
  });

  it('con clave del tenant correcta pero AAD de otro tenant, el descifrado falla', async () => {
    const { store, send } = memoryS3();
    const svc = make(send);
    // Objeto cifrado para 'otro' pero guardado (por error/corrupción) bajo la clave de 'acme'.
    const { ciphertext, enc } = encryptObject(Buffer.from('de otro'), { tenantId: 'otro' });
    store.set('documents/acme/2026-10-01/u-x.pdf', ciphertext);
    await expect(svc.getObject('documents/acme/2026-10-01/u-x.pdf', enc, 'acme')).rejects.toThrow();
  });

  it('objeto legado sin AAD sigue legible', async () => {
    const { store, send } = memoryS3();
    const svc = make(send);
    const { ciphertext, enc } = encryptObject(Buffer.from('viejo'));
    store.set('documents/acme/2026-10-01/u-old.pdf', ciphertext);
    expect((await svc.getObject('documents/acme/2026-10-01/u-old.pdf', enc, 'acme')).toString()).toBe('viejo');
  });

  it('clave legada sin tenant se tolera con aviso y no cruza tenants', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { store, send } = memoryS3();
    const svc = make(send);
    const { ciphertext, enc } = encryptObject(Buffer.from('legado'));
    store.set('documents/2026-01-05/u-x.pdf', ciphertext);
    expect((await svc.getObject('documents/2026-01-05/u-x.pdf', enc, 'acme')).toString()).toBe('legado');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('deleteObject con tenant incorrecto falla sin tocar S3; con el correcto borra', async () => {
    const { store, send } = memoryS3();
    const svc = make(send);
    store.set('documents/acme/2026-10-01/u-x.pdf', Buffer.from('x'));
    await expect(svc.deleteObject('documents/acme/2026-10-01/u-x.pdf', 'otro')).rejects.toThrow(NotFoundException);
    expect(send).not.toHaveBeenCalled();
    await svc.deleteObject('documents/acme/2026-10-01/u-x.pdf', 'acme');
    expect(store.size).toBe(0);
  });
});
