import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { InboxService, type InboxItem } from './inbox.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `/me/*` — siempre relativo al usuario autenticado. La identidad sale del
 * token (JwtAuthGuard), nunca de un query param.
 */
@Controller('me')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('inbox')
  inboxFor(@CurrentUser() user: AuthenticatedUser): Promise<InboxItem[]> {
    return this.inbox.forSigner(user.actorId, user.tenantId);
  }

  @Get('sent')
  sentFor(@CurrentUser() user: AuthenticatedUser): Promise<InboxItem[]> {
    return this.inbox.forRequester(user.actorId, user.tenantId);
  }

  /**
   * Directorio del tenant para el autocompletado de firmantes en `/new`.
   * Solo identidad (userId, nombre, correo) — nunca roles. Cualquier usuario
   * autenticado del tenant puede leerlo; el filtro sale del token.
   */
  @Get('colleagues')
  colleagues(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.tenantMembership.findMany({
      where: {
        // `user.tenantId` del JWT puede ser el slug o el id del tenant;
        // `TenantMembership.tenantId` es el id. Se acepta cualquiera de los dos.
        tenant: { OR: [{ id: user.tenantId }, { slug: user.tenantId }] },
        active: true,
        OR: [{ name: { not: null } }, { email: { not: null } }],
      },
      select: { userId: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { userId: 'asc' }],
    });
  }

  @Get('snapshot')
  async snapshot(@CurrentUser() user: AuthenticatedUser) {
    const userId = user.actorId;
    const [unread, pendingTasks, pendingSign] = await Promise.all([
      this.prisma.userNotification.count({ where: { userId, read: false } }),
      this.prisma.humanTask.count({
        where: { signerId: userId, status: { in: ['CREADA', 'ASIGNADA'] } },
      }),
      this.prisma.signer.count({
        where: {
          OR: [{ signerId: userId }, { delegatedTo: userId }],
          status: 'PENDIENTE',
          signatureRequest: { status: { in: ['PENDIENTE', 'EN_FIRMA'] } },
        },
      }),
    ]);
    return { unread, pendingTasks, pendingSign };
  }
}
