import { describe, expect, it, vi } from 'vitest';

import { SignatureRequestsService } from './signature-requests.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CollaborationService } from '../collaboration/collaboration.service';
import type { SignerMailService } from '../notifications/signer-mail.service';

type Req = {
  id: string;
  documentId: string;
  signers: { signerId: string; name: string | null; status: string; sortOrder: number }[];
};

function makeService(opts: { turnAlreadyAudited?: boolean } = {}) {
  const notify = vi.fn().mockResolvedValue(undefined);
  const audit = vi.fn().mockResolvedValue(undefined);
  const sendInvite = vi.fn().mockResolvedValue(undefined);
  const humanTaskUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

  const prisma = {
    processAuditEvent: { count: vi.fn().mockResolvedValue(opts.turnAlreadyAudited ? 1 : 0) },
    document: { findUnique: vi.fn().mockResolvedValue({ filename: 'contrato.pdf' }) },
    humanTask: { updateMany: humanTaskUpdateMany },
  } as unknown as PrismaService;
  const collab = { notify, audit } as unknown as CollaborationService;
  const mail = { sendInvite } as unknown as SignerMailService;

  const svc = new SignatureRequestsService(
    prisma,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    collab,
    mail,
    undefined as never,
    undefined as never,
  );
  const call = (req: Req) =>
    (svc as unknown as { notifyNextInSequence: (r: Req) => Promise<void> }).notifyNextInSequence(req);
  return { call, notify, audit, sendInvite, humanTaskUpdateMany };
}

const REQ: Req = {
  id: 'sr-1',
  documentId: 'doc-1',
  signers: [
    { signerId: 'ana', name: 'Ana', status: 'FIRMADO', sortOrder: 0 },
    { signerId: 'beto', name: 'Beto', status: 'PENDIENTE', sortOrder: 1 },
    { signerId: 'caro', name: 'Caro', status: 'PENDIENTE', sortOrder: 2 },
  ],
};

describe('SignatureRequestsService.notifyNextInSequence', () => {
  it('avisa solo al siguiente pendiente del orden', async () => {
    const { call, notify, audit, sendInvite } = makeService();
    await call(REQ);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe('beto');
    expect(sendInvite).toHaveBeenCalledWith('sr-1', 'beto');
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SIGNATURE_TURN', payload: expect.objectContaining({ signerId: 'beto' }) }),
    );
  });

  it('es idempotente: no repite si ya se auditó el turno de ese firmante', async () => {
    const { call, notify, audit, sendInvite } = makeService({ turnAlreadyAudited: true });
    await call(REQ);
    expect(notify).not.toHaveBeenCalled();
    expect(sendInvite).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('no hace nada si ya no quedan pendientes', async () => {
    const { call, notify } = makeService();
    await call({ ...REQ, signers: REQ.signers.map((s) => ({ ...s, status: 'FIRMADO' })) });
    expect(notify).not.toHaveBeenCalled();
  });
});
