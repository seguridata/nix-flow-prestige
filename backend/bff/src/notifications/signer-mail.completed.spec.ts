import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_PLACEHOLDER } from './notification-outbox.service';
import { SignerMailService } from './signer-mail.service';

function setup(opts: { presented: boolean }) {
  const request = {
    id: 'sr-1',
    documentId: 'd-1',
    tenantId: 't1',
    requestedBy: 'jefa@acme.mx',
    requestedByName: 'Jefa',
    document: { filename: 'contrato.pdf', presentedObjectKey: opts.presented ? 'presented/x.pdf' : null },
    signers: [
      { signerId: 'ana@ext.com', name: 'Ana', email: 'ana@ext.com', delegatedTo: null, delegatedToName: null },
      { signerId: 'beto', name: 'Beto', email: 'beto@acme.mx', delegatedTo: null, delegatedToName: null },
    ],
  };
  const prisma = {
    signatureRequest: { findUnique: vi.fn(async () => request) },
    evidenceManifest: { findUnique: vi.fn(async () => ({ manifestId: 'm-1' })) },
  };
  const outbox = { enqueueEmail: vi.fn(async () => undefined) };
  const links = {
    issue: vi.fn(async (p: { signerId: string }) => ({ token: 't', url: `https://x/api/public-sign/tok-${p.signerId}/download`, expiresAt: new Date() })),
  };
  const svc = new SignerMailService(prisma as never, outbox as never, links as never);
  return { svc, outbox, links };
}

describe('SignerMailService.sendCompleted - copia firmada', () => {
  afterEach(() => {
    delete process.env.SIGNED_COPY_TO_SIGNERS;
  });

  it('cada firmante recibe su propio enlace de descarga (cifrado en la bandeja, no en el HTML); el emisor no', async () => {
    const { svc, outbox, links } = setup({ presented: true });
    await svc.sendCompleted('sr-1');

    expect(links.issue).toHaveBeenCalledTimes(2);
    expect(links.issue).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'download', signatureRequestId: 'sr-1', signerId: 'ana@ext.com' }));

    const calls = outbox.enqueueEmail.mock.calls.map((c) => c[0] as { to: string; html: string; link?: string });
    const ana = calls.find((c) => c.to === 'ana@ext.com')!;
    expect(ana.link).toBe('https://x/api/public-sign/tok-ana@ext.com/download');
    expect(ana.html).toContain(LINK_PLACEHOLDER);
    expect(ana.html).not.toContain('tok-ana');
    expect(ana.html).toContain('Descargar copia firmada');

    const jefa = calls.find((c) => c.to === 'jefa@acme.mx')!;
    expect(jefa.link).toBeUndefined();
    expect(jefa.html).toContain('Descargar evidencia');
  });

  it('sin copia de ceremonia no emite enlaces de descarga', async () => {
    const { svc, outbox, links } = setup({ presented: false });
    await svc.sendCompleted('sr-1');
    expect(links.issue).not.toHaveBeenCalled();
    expect((outbox.enqueueEmail.mock.calls[0][0] as { html: string }).html).toContain('Descargar evidencia');
  });

  it('SIGNED_COPY_TO_SIGNERS=false apaga la copia (documentos confidenciales)', async () => {
    process.env.SIGNED_COPY_TO_SIGNERS = 'false';
    const { svc, links } = setup({ presented: true });
    await svc.sendCompleted('sr-1');
    expect(links.issue).not.toHaveBeenCalled();
  });
});
