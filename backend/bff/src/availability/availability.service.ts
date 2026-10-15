import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SetOutOfOfficeInput {
  /** Slug del tenant (el que deja TenantContextGuard). */
  tenantId: string;
  userId: string;
  delegateId: string;
  delegateName?: string;
  reason?: string;
  since?: Date;
  until?: Date;
}

/**
 * M07 — «fuera de oficina». Un usuario declara un suplente; las solicitudes de
 * firma que se creen mientras la regla esté vigente se delegan automáticamente
 * (ver `SignatureRequestsService.applyOutOfOffice`).
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  get(tenantId: string, userId: string) {
    return this.prisma.outOfOffice.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  }

  async set(input: SetOutOfOfficeInput) {
    if (input.delegateId === input.userId) {
      throw new BadRequestException('El suplente no puede ser el mismo usuario');
    }
    if (input.until && input.since && input.until <= input.since) {
      throw new BadRequestException('La fecha «hasta» debe ser posterior a «desde»');
    }
    const data = {
      delegateId: input.delegateId,
      delegateName: input.delegateName ?? null,
      reason: input.reason ?? null,
      since: input.since ?? new Date(),
      until: input.until ?? null,
    };
    return this.prisma.outOfOffice.upsert({
      where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
      create: { tenantId: input.tenantId, userId: input.userId, ...data },
      update: data,
    });
  }

  async clear(tenantId: string, userId: string) {
    await this.prisma.outOfOffice.deleteMany({ where: { tenantId, userId } });
    return { ok: true };
  }
}
