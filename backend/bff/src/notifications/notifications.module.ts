import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationDispatcher } from './notification-dispatcher';
import { OneTimeLinkService } from './one-time-link.service';
import { SignerMailService } from './signer-mail.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [
    MailerService,
    NotificationOutboxService,
    NotificationDispatcher,
    OneTimeLinkService,
    SignerMailService,
  ],
  exports: [MailerService, NotificationOutboxService, OneTimeLinkService, SignerMailService],
})
export class NotificationsModule {}
