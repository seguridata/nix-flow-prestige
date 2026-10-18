import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { BadRequestException, GoneException, HttpException, NotFoundException } from '@nestjs/common';
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
  failedAttempts: number;
  lockedUntil: Date | null;
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
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Omit<Partial<LinkRow>, 'failedAttempts'> & { failedAttempts?: number | { increment: number } };
      }) => {
        const r = rows.find((x) => x.id === where.id)!;
        const { failedAttempts, ...rest } = data;
        Object.assign(r, rest);
        if (typeof failedAttempts === 'number') r.failedAttempts = failedAttempts;
        else if (failedAttempts) r.failedAttempts += failedAttempts.increment;
        return r;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; usedAt?: null; signatureRequestId?: string; signerId?: string };
        data: Partial<LinkRow>;
      }) => {
        let count = 0;
        for (const r of rows) {
          if (where.id && r.id !== where.id) continue;
          if (where.usedAt === null && r.usedAt !== null) continue;
          if (where.signatureRequestId && r.signatureRequestId !== where.signatureRequestId) continue;
          if (where.signerId && r.signerId !== where.signerId) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
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

describe('OneTimeLinkService - copia firmada y bloqueo', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PUBLIC_LINK_MAX_FAILURES;
    delete process.env.PUBLIC_LINK_LOCK_MINUTES;
  });

  it('el enlace de descarga apunta al proxy público, dura días y no sirve para firmar', async () => {
    process.env.PUBLIC_WEB_URL = 'https://firma.example';
    const { prisma, rows } = fakePrisma();
    const svc = new OneTimeLinkService(prisma);

    const issued = await svc.issue({ purpose: 'download', signerId: 'ana', signatureRequestId: 'req-1' });
    expect(issued.url).toBe(`https://firma.example/api/public-sign/${issued.token}/download`);
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);

    await expect(svc.resolve(issued.token)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.resolve(issued.token, 'download')).resolves.toMatchObject({ purpose: 'download' });
    // Un token de firma tampoco sirve para descargar.
    const sign = await svc.issue({ signerId: 'ana', signatureRequestId: 'req-1' });
    await expect(svc.resolve(sign.token, 'download')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tras N fallos bloquea el enlace (429) sin consumirlo y se libera al vencer el bloqueo', async () => {
    process.env.PUBLIC_LINK_MAX_FAILURES = '3';
    process.env.PUBLIC_LINK_LOCK_MINUTES = '10';
    const { prisma, rows } = fakePrisma();
    const svc = new OneTimeLinkService(prisma);
    const { token } = await svc.issue({ signerId: 'ana', signatureRequestId: 'req-1' });

    await svc.recordFailure(token);
    await svc.recordFailure(token);
    await expect(svc.resolve(token)).resolves.toMatchObject({ signerId: 'ana' });

    await svc.recordFailure(token);
    const err = await svc.resolve(token).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(rows[0].usedAt).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await expect(svc.resolve(token)).resolves.toMatchObject({ signerId: 'ana' });
  });

  it('un token inexistente o ya usado no suma fallos ni lanza', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new OneTimeLinkService(prisma);
    await expect(svc.recordFailure('x'.repeat(30))).resolves.toBeUndefined();
    const { token } = await svc.issue({ signerId: 'ana' });
    await svc.consume(token);
    await svc.recordFailure(token);
    expect(rows[0].failedAttempts).toBe(0);
  });
});
