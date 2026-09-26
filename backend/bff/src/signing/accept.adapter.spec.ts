import { describe, expect, it } from 'vitest';
import { AcceptSignerAdapter } from './accept.adapter';

describe('AcceptSignerAdapter', () => {
  it('firma sobre el hash congelado sin trazo, sin PDF incrustado y sin pending', async () => {
    const adapter = new AcceptSignerAdapter();
    const result = await adapter.sign({
      method: 'ACCEPT',
      signerId: 'ana@seguridata.mx',
      documentId: 'doc-1',
      documentHash: 'a'.repeat(64),
      pdfBytes: Buffer.from('%PDF-1.4 ignorado'),
    });

    expect(result.signedPdf).toBeUndefined();
    expect(result.pending).toBeUndefined();
    expect(result.certificate).toBeUndefined();
    expect(result.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el hash de firma depende del documento y del firmante (distinto firmante -> distinto hash)', async () => {
    const adapter = new AcceptSignerAdapter();
    const base = { method: 'ACCEPT' as const, documentId: 'doc-1', documentHash: 'b'.repeat(64), pdfBytes: Buffer.alloc(0) };

    const a = await adapter.sign({ ...base, signerId: 'ana' });
    const b = await adapter.sign({ ...base, signerId: 'carlos' });
    expect(a.signatureHash).not.toBe(b.signatureHash);
  });

  it('reporta capabilities().configured = true (siempre disponible, no depende de un proveedor)', () => {
    const adapter = new AcceptSignerAdapter();
    expect(adapter.capabilities()).toEqual({ configured: true });
  });
});
