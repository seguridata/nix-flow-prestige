import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { NotificationOutboxService } from './notification-outbox.service';

class OutboxQueryDto {
  @IsOptional() @IsIn(['PENDIENTE', 'ENVIADO', 'FALLIDO', 'DLQ'])
  status?: string;
}

/**
 * M13 — operación de la bandeja de salida de correo. Sólo administración.
 */
@Roles('admin')
@Controller('notifications/outbox')
export class NotificationsController {
  constructor(private readonly outbox: NotificationOutboxService) {}

  @Get()
  list(@Query() query: OutboxQueryDto) {
    return this.outbox.list({ status: query.status });
  }

  @Get('dlq')
  dlq() {
    return this.outbox.list({ status: 'DLQ' });
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.outbox.retry(id);
  }

  @Post('dispatch')
  dispatch() {
    return this.outbox.dispatchDue();
  }
}
