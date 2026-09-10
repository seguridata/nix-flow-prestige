import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { WorkerGuard } from '../auth/worker.guard';
import { WorkflowService } from './workflow.service';
import type { ContratoWorkflowInput, NudgeCommand } from '../temporal/shared';

/**
 * Endpoints que consume el worker de Temporal (activities vía HTTP). No usan
 * JWT de Keycloak (`@Public()`) pero sí exigen el token de worker firmado
 * (`WorkerGuard` + `X-Prestige-Worker-Token`).
 */
@Controller('internal/workflows')
@UseGuards(WorkerGuard)
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

  @Public()
  @Post('nudge')
  nudge(@Body() body: NudgeCommand) {
    return this.workflow.nudge(body);
  }
}
