import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { WorkerGuard } from '../auth/worker.guard';
import { WorkflowService } from './workflow.service';
import type { ContratoWorkflowInput } from '../temporal/shared';

class NudgeCommandDto {
  @IsString() @MaxLength(200)
  signatureRequestId!: string;

  @IsIn(['REMINDER', 'ESCALATION'])
  kind!: 'REMINDER' | 'ESCALATION';

  @IsNumber() @Min(0) @Max(1)
  ratio!: number;

  @IsOptional() @IsString() @MaxLength(200)
  signerId?: string;
}

/**
 * Endpoints que consume el worker de Temporal (activities vía HTTP).
 * `@Public()` es intencional y no los deja abiertos: salta solo el JWT de
 * Keycloak. La clase exige `WorkerGuard` (HMAC con `WORKER_SHARED_SECRET`
 * en `X-Prestige-Worker-Token`, minuto actual o el anterior). Sin ese
 * header responden 401.
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
  nudge(@Body() body: NudgeCommandDto) {
    return this.workflow.nudge(body);
  }
}
