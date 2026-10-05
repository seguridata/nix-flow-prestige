import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
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

class SignatureRequestIdDto {
  @IsString() @MinLength(1) @MaxLength(200)
  signatureRequestId!: string;
}

class SeedSignerDto {
  @IsString() @MinLength(1) @MaxLength(200)
  signerId!: string;

  @IsOptional() @IsString() @MaxLength(200)
  name?: string;
}

class SeedTasksDto {
  @IsString() @MinLength(1) @MaxLength(200)
  signatureRequestId!: string;

  @IsString() @MaxLength(200)
  documentId!: string;

  @IsOptional() @IsString() @MaxLength(200)
  caseId?: string;

  @IsIn(['SECUENCIAL', 'PARALELO'])
  order!: 'SECUENCIAL' | 'PARALELO';

  @IsNumber() @Min(1) @Max(24 * 365)
  slaHours!: number;

  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SeedSignerDto)
  signers!: SeedSignerDto[];

  @IsOptional() @IsString() @MaxLength(100)
  processKey?: string;
}

/**
 * Endpoints que consume el worker de Temporal (activities vía HTTP).
 * `@Public()` es intencional y no los deja abiertos: salta solo el JWT de
 * Keycloak. La clase exige `WorkerGuard` (HMAC con `WORKER_SHARED_SECRET`
 * sobre método+path+body+timestamp, ventana de 60 s y anti-replay). Sin ese
 * header responden 401.
 */
@Controller('internal/workflows')
@UseGuards(WorkerGuard)
export class WorkflowInternalController {
  constructor(private readonly workflow: WorkflowService) {}

  @Public()
  @Post('seed-tasks')
  seed(@Body() body: SeedTasksDto) {
    return this.workflow.seedTasks(body as ContratoWorkflowInput, `${body.processKey ?? 'contratoDosPartes'}:${body.signatureRequestId}`);
  }

  @Public()
  @Post('expire')
  expire(@Body() body: SignatureRequestIdDto) {
    return this.workflow.expire(body.signatureRequestId);
  }

  @Public()
  @Post('seal-evidence')
  seal(@Body() body: SignatureRequestIdDto) {
    return this.workflow.seal(body.signatureRequestId);
  }

  @Public()
  @Post('nudge')
  nudge(@Body() body: NudgeCommandDto) {
    return this.workflow.nudge(body);
  }
}
