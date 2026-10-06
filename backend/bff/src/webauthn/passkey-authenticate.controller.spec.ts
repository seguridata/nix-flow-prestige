import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PasskeyAuthenticateController } from './passkey-authenticate.controller';

const user = { actorId: 'ana', tenantId: 't1' } as never;

function build(status: string | null) {
  const ceremony = { beginForUser: vi.fn(async () => ({ assertionId: 'a', options: {} })) };
  const prisma = {
    signatureRequest: { findFirst: vi.fn(async () => (status ? { status } : null)) },
  };
  const ctrl = new PasskeyAuthenticateController(ceremony as never, prisma as never);
  return { ctrl, ceremony, prisma };
}

describe('PasskeyAuthenticateController.begin', () => {
  it.each(['COMPLETADA', 'RECHAZADA', 'CANCELADA', 'EXPIRADA'])('409 si la solicitud está %s', async (status) => {
    const { ctrl, ceremony } = build(status);
    await expect(ctrl.begin(user, { signatureRequestId: 'sr-1' })).rejects.toBeInstanceOf(ConflictException);
    expect(ceremony.beginForUser).not.toHaveBeenCalled();
  });

  it.each(['PENDIENTE', 'EN_FIRMA'])('delega en la ceremonia si está %s', async (status) => {
    const { ctrl, ceremony, prisma } = build(status);
    await ctrl.begin(user, { signatureRequestId: 'sr-1' });
    expect(prisma.signatureRequest.findFirst).toHaveBeenCalledWith({
      where: { id: 'sr-1', tenantId: 't1' },
      select: { status: true },
    });
    expect(ceremony.beginForUser).toHaveBeenCalledWith(user, 'sr-1');
  });

  it('si no existe (o es ajena) delega para que la ceremonia responda 404', async () => {
    const { ctrl, ceremony } = build(null);
    await ctrl.begin(user, { signatureRequestId: 'sr-x' });
    expect(ceremony.beginForUser).toHaveBeenCalled();
  });
});
