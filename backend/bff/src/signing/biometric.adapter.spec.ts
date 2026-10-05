import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { BiometricSignerAdapter } from './biometric.adapter';
import type { SignCommand } from './signer-adapter';

const cmd = (over: Partial<SignCommand> = {}): SignCommand => ({
  method: 'BIOMETRICA',
  signerId: 'ana',
  documentId: 'doc-1',
  tenantId: 't',
  signatureRequestId: 'sr-1',
  documentHash: 'h'.repeat(64),
  pdfBytes: Buffer.from('%PDF-1.4'),
  biometricSessionId: 'sess-1',
  ...over,
});

describe('BiometricSignerAdapter.sign', () => {
  const adapter = new BiometricSignerAdapter();
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.BIOMETRIC_PROVIDER_URL = 'https://bio.example/';
    process.env.BIOMETRIC_API_KEY = 'k';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BIOMETRIC_PROVIDER_URL;
  });

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('exige biometricSessionId (sin fallback a latest) y no llama al proveedor', async () => {
    await expect(adapter.sign(cmd({ biometricSessionId: undefined }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(adapter.sign(cmd({ biometricSessionId: '  ' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('codifica el id de sesion en la URL y aplica un timeout (AbortSignal)', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'completed' }));
    const weird = '../admin?x=1/../';
    await adapter.sign(cmd({ biometricSessionId: weird }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bio.example/sessions/' + encodeURIComponent(weird) + '/verify');
    expect(url).not.toContain('/../');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rechaza una sesion que el proveedor atribuye a OTRO firmante o a OTRO documento', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'completed', signerId: 'otra-persona' }));
    await expect(adapter.sign(cmd())).rejects.toBeInstanceOf(UnprocessableEntityException);
    fetchMock.mockResolvedValue(ok({ status: 'completed', documentHash: 'otro-doc' }));
    await expect(adapter.sign(cmd())).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('acepta la sesion cuando firmante y documento coinciden (o el proveedor no los informa)', async () => {
    fetchMock.mockResolvedValue(ok({ status: 'completed', signerId: 'ana', documentHash: 'h'.repeat(64) }));
    await expect(adapter.sign(cmd())).resolves.toMatchObject({ algorithm: 'BIOMETRIC-LIVENESS' });
    fetchMock.mockResolvedValue(ok({ status: 'pending', ref: 'op-1' }));
    await expect(adapter.sign(cmd())).resolves.toMatchObject({ pending: true, pendingRef: 'op-1' });
  });
});
