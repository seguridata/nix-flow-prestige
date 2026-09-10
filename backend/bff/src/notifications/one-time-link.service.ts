import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedLink {
  token: string;
  url: string;
  expiresAt: Date;
}

export interface ResolvedLink {
  id: string;
  purpose: string;
  signerId: string;
  signatureRequestId: string | null;
  expiresAt: Date;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * M13 / A-12 — enlaces de un solo uso para el portal del firmante externo.
 * El token viaja sólo en el correo; en BD se guarda su SHA-256. Se marca
 * `usedAt` cuando la firma se aplica correctamente por ese enlace.
 */
@Injectable()
export class OneTimeLinkService {
  constructor(private readonly prisma: PrismaService) {}

  private baseUrl(): string {
    return (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  async issue(params: {
    purpose?: string;
    signerId: string;
    signatureRequestId?: string;
    ttlHours?: number;
  }): Promise<IssuedLink> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (params.ttlHours ?? 24 * 14) * 3600_000);
    await this.prisma.oneTimeLink.create({
      data: {
        purpose: params.purpose ?? 'sign',
        signerId: params.signerId,
        signatureRequestId: params.signatureRequestId,
        tokenHash: hash(token),
        expiresAt,
      },
    });
    return { token, url: `${this.baseUrl()}/firmar/${token}`, expiresAt };
  }

  async resolve(token: string): Promise<ResolvedLink> {
    if (!token || token.length < 20) throw new BadRequestException('Enlace inválido');
    const row = await this.prisma.oneTimeLink.findUnique({ where: { tokenHash: hash(token) } });
    if (!row) throw new NotFoundException('Enlace no encontrado');
    if (row.usedAt) throw new GoneException('Este enlace ya se utilizó');
    if (row.expiresAt.getTime() < Date.now()) throw new GoneException('Este enlace expiró');
    return {
      id: row.id,
      purpose: row.purpose,
      signerId: row.signerId,
      signatureRequestId: row.signatureRequestId,
      expiresAt: row.expiresAt,
    };
  }

  async consume(token: string) {
    const row = await this.prisma.oneTimeLink.findUnique({ where: { tokenHash: hash(token) } });
    if (!row || row.usedAt) return;
    await this.prisma.oneTimeLink.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  }
}
