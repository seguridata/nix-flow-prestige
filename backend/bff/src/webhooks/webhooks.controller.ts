import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';

class CreateWebhookDto {
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] }) @MaxLength(2000)
  url!: string;

  @IsOptional() @IsArray() @ArrayNotEmpty() @IsString({ each: true }) @MaxLength(120, { each: true })
  events?: string[];

  @IsOptional() @IsString() @MaxLength(200)
  description?: string;

  @IsOptional() @IsString() @MaxLength(200)
  secret?: string;
}

class UpdateWebhookDto {
  @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'] }) @MaxLength(2000)
  url?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(120, { each: true })
  events?: string[];

  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @IsString() @MaxLength(200)
  description?: string;
}

class DeliveryQueryDto {
  @IsOptional() @IsIn(['PENDIENTE', 'ENVIADO', 'FALLIDO', 'DLQ'])
  status?: string;
}

/**
 * M14 — administración de webhooks del tenant (rol `admin`). Las entregas se
 * firman con HMAC-SHA256 (`X-Prestige-Signature: sha256=<hmac(timestamp.body)>`).
 */
@ApiTags('webhooks')
@Roles('admin')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('subscriptions')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.webhooks.list(user.tenantId);
  }

  @Post('subscriptions')
  create(@Body() body: CreateWebhookDto, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooks.create(user.tenantId, body);
  }

  @Patch('subscriptions/:id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooks.update(user.tenantId, id, body);
  }

  @Delete('subscriptions/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooks.remove(user.tenantId, id);
  }

  @Post('subscriptions/:id/ping')
  ping(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooks.ping(user.tenantId, id);
  }

  @Get('deliveries')
  deliveries(@Query() query: DeliveryQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooks.listDeliveries(user.tenantId, { status: query.status });
  }

  @Post('deliveries/:id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.webhooks.retryDelivery(user.tenantId, id);
  }
}
