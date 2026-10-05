import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { PageQueryDto } from '../common/pagination';
import { NotificationOutboxService } from './notification-outbox.service';

class OutboxQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['PENDIENTE', 'ENVIADO', 'FALLIDO', 'DLQ'])
  status?: string;
}

/**
 * M13 — operación de la bandeja de salida de correo. Sólo administración,
 * acotada al tenant del admin (`user.tenantId`).
 */
@Roles('admin')
@Controller('notifications/outbox')
export class NotificationsController {
  constructor(private readonly outbox: NotificationOutboxService) {}

  @Get()
  list(@Query() query: OutboxQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.outbox.list({ tenantId: user.tenantId, status: query.status, limit: query.limit, cursor: query.cursor });
  }

  @Get('dlq')
  dlq(@Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.outbox.list({ tenantId: user.tenantId, status: 'DLQ', limit: page.limit, cursor: page.cursor });
  }

  @Post('dispatch')
  dispatch(@CurrentUser() user: AuthenticatedUser) {
    return this.outbox.dispatchDue(25, user.tenantId);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.outbox.retry(id, user.tenantId);
  }
}
