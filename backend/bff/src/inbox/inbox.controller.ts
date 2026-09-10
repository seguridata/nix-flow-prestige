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
    return this.inbox.forSigner(user.actorId);
  }

  @Get('sent')
  sentFor(@CurrentUser() user: AuthenticatedUser): Promise<InboxItem[]> {
    return this.inbox.forRequester(user.actorId);
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
