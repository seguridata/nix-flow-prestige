/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger, NotFoundException } from '@nestjs/common';
import { StorageService, assertTenantKey } from './storage.service';

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
