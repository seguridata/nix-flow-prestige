import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PageQueryDto } from '../common/pagination';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
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

  // Catálogo de plataforma (no por tenant): lectura abierta, escritura solo admin.
  @Get('process-definitions')
  list(@Query() page: PageQueryDto) {
    return this.process.list(page);
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
  audit(@Query() query: AuditQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.listAudit(query, user.tenantId);
  }

  /**
   * M11 — verifica la cadena de auditoría inmutable DEL TENANT del usuario
   * (modo scoped: coherencia de cada evento + seq creciente), solo admin,
   * con tope de eventos. Con `signatureRequestId`/`onboardingId` se acota más.
   */
  @Roles('admin')
  @Get('process-audit/verify')
  async verifyAudit(@Query() query: AuditQueryDto, @CurrentUser() user: AuthenticatedUser) {
    // Siempre acotado al tenant del usuario (no hay noción de admin de plataforma)
    // y con tope de eventos en AuditChainService.verify. Si se pasa un recurso,
    // debe pertenecer al tenant (404 si no).
    if (query.signatureRequestId || query.onboardingId) {
      await this.process.listAudit(
        { signatureRequestId: query.signatureRequestId, onboardingId: query.onboardingId },
        user.tenantId,
      );
    }
    return this.auditChain.verify({
      signatureRequestId: query.signatureRequestId,
      onboardingId: query.onboardingId,
      tenantId: user.tenantId,
    });
  }
}
