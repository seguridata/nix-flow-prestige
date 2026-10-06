import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

/** Propósitos de enlace: firmar (un solo uso) o descargar la copia firmada (ventana de tiempo). */
export type LinkPurpose = 'sign' | 'download';

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

  /** Ventana de la copia firmada: el enlace NO se consume al descargar (los escáneres de correo lo abren antes que la persona). */
  private downloadTtlHours(): number {
    const v = Number(process.env.SIGNED_COPY_TTL_DAYS);
    return (Number.isFinite(v) && v > 0 ? v : 7) * 24;
  }

  private maxFailures(): number {
    const v = Number(process.env.PUBLIC_LINK_MAX_FAILURES);
    return Number.isFinite(v) && v > 0 ? v : 5;
  }

  private lockMinutes(): number {
    const v = Number(process.env.PUBLIC_LINK_LOCK_MINUTES);
    return Number.isFinite(v) && v > 0 ? v : 15;
  }

  async issue(params: {
    purpose?: LinkPurpose;
    signerId: string;
    signatureRequestId?: string;
    ttlHours?: number;
  }): Promise<IssuedLink> {
    const token = randomBytes(32).toString('base64url');
    const purpose = params.purpose ?? 'sign';
    const ttl = params.ttlHours ?? (purpose === 'download' ? this.downloadTtlHours() : this.defaultTtlHours());
    const expiresAt = new Date(Date.now() + ttl * 3600_000);
    await this.prisma.oneTimeLink.create({
      data: {
        purpose,
        signerId: params.signerId,
        signatureRequestId: params.signatureRequestId,
        tokenHash: hash(token),
        expiresAt,
      },
    });
    // La descarga apunta directo al proxy público (devuelve el PDF), no a una página.
    const path = purpose === 'download' ? `/api/public-sign/${token}/download` : `/firmar/${token}`;
    return { token, url: `${this.baseUrl()}${path}`, expiresAt };
  }

  /**
   * `purpose` acota para qué operación se acepta el enlace: un enlace de
   * descarga no sirve para firmar/consentir y viceversa.
   */
  async resolve(token: string, purpose: LinkPurpose = 'sign'): Promise<ResolvedLink> {
    if (!token || token.length < 20) throw new BadRequestException('Enlace inválido');
    const row = await this.prisma.oneTimeLink.findUnique({ where: { tokenHash: hash(token) } });
    if (!row) throw new NotFoundException('Enlace no encontrado');
    if (row.usedAt) throw new GoneException('Este enlace ya se utilizó');
    if (row.expiresAt.getTime() < Date.now()) throw new GoneException('Este enlace expiró');
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        'Demasiados intentos fallidos con este enlace. Espera unos minutos e intenta de nuevo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (row.purpose !== purpose) throw new BadRequestException('El enlace no sirve para esta operación');
    return {
      id: row.id,
      purpose: row.purpose,
      signerId: row.signerId,
      signatureRequestId: row.signatureRequestId,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * Cuenta un intento fallido con un enlace VIVO (aserción de passkey o firma
   * rechazada). Al llegar al máximo bloquea el enlace `lockMinutes` sin
   * consumirlo, para que la persona legítima pueda reintentar después. Un
   * token inexistente no pasa por aquí: lo frena el throttler por IP.
   */
  async recordFailure(token: string): Promise<void> {
    const row = await this.prisma.oneTimeLink.findUnique({ where: { tokenHash: hash(token) } });
    if (!row || row.usedAt) return;
    // Incremento atómico: fallos concurrentes no se pierden por read-modify-write.
    const updated = await this.prisma.oneTimeLink.update({
      where: { id: row.id },
      data: { failedAttempts: { increment: 1 } },
    });
    if (updated.failedAttempts >= this.maxFailures()) {
      await this.prisma.oneTimeLink.update({
        where: { id: row.id },
        data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + this.lockMinutes() * 60_000) },
      });
    }
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
