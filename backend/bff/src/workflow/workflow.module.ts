import { Module } from '@nestjs/common';
import { EvidenceModule } from '../evidence/evidence.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowInternalController } from './internal.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [EvidenceModule],
  controllers: [WorkflowController, WorkflowInternalController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
