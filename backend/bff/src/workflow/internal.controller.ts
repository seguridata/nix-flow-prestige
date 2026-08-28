import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { WorkflowService } from './workflow.service';
import type { ContratoWorkflowInput } from '../temporal/shared';

@Controller('internal/workflows')
export class WorkflowInternalController {
  constructor(private readonly workflow: WorkflowService) {}

  @Public()
  @Post('seed-tasks')
  seed(@Body() body: ContratoWorkflowInput & { processKey?: string }) {
    return this.workflow.seedTasks(body, `${body.processKey ?? 'contratoDosPartes'}:${body.signatureRequestId}`);
  }

  @Public()
  @Post('expire')
  expire(@Body() body: { signatureRequestId: string }) {
    return this.workflow.expire(body.signatureRequestId);
  }

  @Public()
  @Post('seal-evidence')
  seal(@Body() body: { signatureRequestId: string }) {
    return this.workflow.seal(body.signatureRequestId);
  }
}
