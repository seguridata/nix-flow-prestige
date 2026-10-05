/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service';

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
