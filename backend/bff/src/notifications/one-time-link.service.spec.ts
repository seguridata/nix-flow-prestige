import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { GoneException, NotFoundException } from '@nestjs/common';
import { OneTimeLinkService } from './one-time-link.service';
import type { PrismaService } from '../prisma/prisma.service';

interface LinkRow {
  id: string;
  purpose: string;
  signerId: string;
  signatureRequestId: string | null;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

function fakePrisma() {
  const rows: LinkRow[] = [];
  const prisma = {
    oneTimeLink: {
      create: async ({ data }: { data: Partial<LinkRow> }) => {
        const row: LinkRow = {
          id: `l${rows.length}`,
          purpose: data.purpose ?? 'sign',
          signerId: data.signerId!,
          signatureRequestId: data.signatureRequestId ?? null,
          tokenHash: data.tokenHash!,
          expiresAt: data.expiresAt!,
          usedAt: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<LinkRow> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
  } as unknown as PrismaService;
  return { prisma, rows };
}

describe('OneTimeLinkService', () => {
  it('emite un token, guarda sólo su hash y arma la URL del portal', async () => {
    process.env.PUBLIC_WEB_URL = 'https://firma.example';
    const { prisma, rows } = fakePrisma();
    const svc = new OneTimeLinkService(prisma);

    const issued = await svc.issue({ signerId: 'ana', signatureRequestId: 'req-1' });
    expect(issued.url).toBe(`https://firma.example/firmar/${issued.token}`);
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(issued.token).digest('hex'));
    expect(rows[0].tokenHash).not.toContain(issued.token);

    const resolved = await svc.resolve(issued.token);
    expect(resolved).toMatchObject({ signerId: 'ana', signatureRequestId: 'req-1', purpose: 'sign' });
  });

  it('rechaza un token inexistente, expirado o ya usado', async () => {
    const { prisma } = fakePrisma();
    const svc = new OneTimeLinkService(prisma);

    await expect(svc.resolve('x'.repeat(30))).rejects.toBeInstanceOf(NotFoundException);

    const good = await svc.issue({ signerId: 'ana', ttlHours: 1 });
    await svc.consume(good.token);
    await expect(svc.resolve(good.token)).rejects.toBeInstanceOf(GoneException);

    const expired = await svc.issue({ signerId: 'ana', ttlHours: -1 });
    await expect(svc.resolve(expired.token)).rejects.toBeInstanceOf(GoneException);
  });
});
