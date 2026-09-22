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

  private defaultTtlHours(): number {
    const v = Number(process.env.ONE_TIME_LINK_TTL_HOURS);
    return Number.isFinite(v) && v > 0 ? v : 72;
  }

  async issue(params: {
    purpose?: string;
    signerId: string;
    signatureRequestId?: string;
    ttlHours?: number;
  }): Promise<IssuedLink> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (params.ttlHours ?? this.defaultTtlHours()) * 3600_000);
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

  /**
   * Marca el token como usado de forma atómica (`where usedAt: null`) para que
   * dos peticiones concurrentes con el mismo enlace no ambas «ganen».
   * Devuelve `true` sólo si esta llamada fue la que lo consumió.
   */
  async consume(token: string): Promise<boolean> {
    const row = await this.prisma.oneTimeLink.findUnique({ where: { tokenHash: hash(token) } });
    if (!row) return false;
    const res = await this.prisma.oneTimeLink.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (res.count === 0) return false;
    // Al firmar, invalida el resto de enlaces vivos del firmante en esa solicitud
    // (invitación + recordatorios) para que no sigan resolviendo tras COMPLETADA.
    if (row.signatureRequestId) {
      await this.prisma.oneTimeLink.updateMany({
        where: { signatureRequestId: row.signatureRequestId, signerId: row.signerId, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
    return true;
  }
}
