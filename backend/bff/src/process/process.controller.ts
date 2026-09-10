import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { AuditChainService } from '../collaboration/audit-chain.service';
import { ProcessService } from './process.service';

class SaveProcessDto {
  @IsOptional() @IsString() @MaxLength(2_000_000)
  bpmnXml?: string;

  @IsOptional() @IsString() @MaxLength(2_000_000)
  dmnXml?: string;

  @IsOptional() @IsString() @MaxLength(200)
  name?: string;
}

class DecideDto {
  @IsOptional() @IsString() @MaxLength(80)
  tipo?: string;

  @IsOptional() @IsString() @MaxLength(120)
  processKey?: string;

  /** Contexto adicional para el motor DMN (monto, area, riesgo, …). */
  @IsOptional() @IsObject()
  context?: Record<string, unknown>;
}

class AuditQueryDto {
  @IsOptional() @IsString() @MaxLength(200) signatureRequestId?: string;
  @IsOptional() @IsString() @MaxLength(200) documentId?: string;
  @IsOptional() @IsString() @MaxLength(200) onboardingId?: string;
}

@Controller()
export class ProcessController {
  constructor(
    private readonly process: ProcessService,
    private readonly auditChain: AuditChainService,
  ) {}

  @Get('process-definitions')
  list() {
    return this.process.list();
  }

  @Get('process-definitions/:key')
  get(@Param('key') key: string) {
    return this.process.getLatest(key);
  }

  @Get('process-definitions/:key/bpmn')
  async bpmn(@Param('key') key: string) {
    const def = await this.process.getLatest(key);
    return { xml: def.bpmnXml, key: def.key, version: def.version, name: def.name };
  }

  @Get('process-definitions/:key/dmn')
  async dmn(@Param('key') key: string) {
    const def = await this.process.getLatest(key);
    return { xml: def.dmnXml, key: def.key, version: def.version };
  }

  @Roles('admin')
  @Put('process-definitions/:key')
  save(@Param('key') key: string, @Body() body: SaveProcessDto) {
    return this.process.saveXml(key, body);
  }

  @Post('process-definitions/:key/decide')
  decide(@Param('key') key: string, @Body() body: DecideDto) {
    return this.process.decide({ tipo: body.tipo ?? 'contrato', ...(body.context ?? {}) }, body.processKey ?? key);
  }

  @Get('process-audit')
  audit(@Query() query: AuditQueryDto) {
    return this.process.listAudit(query);
  }

  /**
   * M11 — verifica la cadena de auditoría inmutable. Sin parámetros: cadena
   * GLOBAL (recalcula todo). Con `signatureRequestId`/`onboardingId`: SCOPED.
   */
  @Get('process-audit/verify')
  verifyAudit(@Query() query: AuditQueryDto) {
    return this.auditChain.verify({
      signatureRequestId: query.signatureRequestId,
      onboardingId: query.onboardingId,
    });
  }
}
