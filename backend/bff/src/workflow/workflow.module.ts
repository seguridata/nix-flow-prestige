import { Module } from '@nestjs/common';
import { EvidenceModule } from '../evidence/evidence.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowInternalController } from './internal.controller';
import { WorkflowReconcilerService } from './workflow-reconciler.service';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [EvidenceModule, NotificationsModule],
  controllers: [WorkflowController, WorkflowInternalController],
  providers: [WorkflowService, WorkflowReconcilerService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
