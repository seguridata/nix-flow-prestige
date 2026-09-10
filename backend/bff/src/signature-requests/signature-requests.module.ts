import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { SigningModule } from '../signing/signing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SignatureRequestsController } from './signature-requests.controller';
import { PublicSignController } from './public-sign.controller';
import { SignatureRequestsService } from './signature-requests.service';

@Module({
  imports: [RealtimeModule, EvidenceModule, WorkflowModule, SigningModule, NotificationsModule],
  controllers: [SignatureRequestsController, PublicSignController],
  providers: [SignatureRequestsService],
  exports: [SignatureRequestsService],
})
export class SignatureRequestsModule {}
