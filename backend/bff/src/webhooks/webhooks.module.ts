import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDispatcher } from './webhook-dispatcher';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcher],
  exports: [WebhooksService],
})
export class WebhooksModule {}
