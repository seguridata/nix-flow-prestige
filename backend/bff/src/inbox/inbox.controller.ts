import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { InboxService, type InboxItem } from './inbox.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('me')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('inbox')
  inboxFor(@Query('signerId') signerId: string): Promise<InboxItem[]> {
    return this.inbox.forSigner(signerId);
  }

  @Public()
  @Get('sent')
  sentFor(@Query('requestedBy') requestedBy: string): Promise<InboxItem[]> {
    return this.inbox.forRequester(requestedBy);
  }

  @Public()
  @Get('snapshot')
  async snapshot(@Query('userId') userId: string) {
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
