import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { PageQueryDto } from '../common/pagination';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { bpmnToFlow } from '../flow/bpmn-to-flow';
import { publicFlow, validateFlow } from '../flow/flow';
import type { FlowVariable } from '../flow/flow.types';
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

class ListProcessQueryDto extends PageQueryDto {
  /** `true` → solo las versiones publicadas (lo que ve quien crea un sobre). */
  @IsOptional() @IsIn(['true', 'false'])
  published?: string;
}

class CreateFlowDto {
  @IsString() @MinLength(3) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  /** Se valida con `validateFlow` (errores en español). */
  @IsObject()
  flow!: Record<string, unknown>;
}

class SaveFlowDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsObject()
  flow!: Record<string, unknown>;
}

class ValidateFlowDto {
  @IsObject()
  flow!: Record<string, unknown>;
}

class PreflightDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  version?: number;

  @IsOptional() @IsObject()
  flow?: Record<string, unknown>;
}

class PreviewFlowDto extends PreflightDto {
  @IsOptional() @IsObject()
  values?: Record<string, unknown>;
}

class ImportProcessPackageDto {
  @IsString() @IsIn(['prestige-process'])
  format!: string;

  @Type(() => Number) @IsInt() @IsIn([1])
  version!: number;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsString() @MinLength(64) @MaxLength(64)
  sha256!: string;
}

class FromBpmnDto {
  @IsString() @MinLength(10) @MaxLength(2_000_000)
  xml!: string;

  /** Variables ya definidas (p. ej. las del flujo anterior), para no perderlas al convertir. */
  @IsOptional() @IsArray() @Type(() => Object)
  variables?: unknown[];
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

  // Los remitentes solo reciben flujos publicados y su representación pública.
  @Get('process-definitions')
  async list(@Query() query: ListProcessQueryDto, @CurrentUser() user: AuthenticatedUser) {
    if (!user.roles?.includes('admin')) {
      return (await this.process.listPublished(user.tenantId)).map((definition) => ({
        id: definition.id, key: definition.key, name: definition.name, description: definition.description,
        version: definition.version, published: definition.published, publishedAt: definition.publishedAt,
        updatedAt: definition.updatedAt, flow: publicFlow(definition.flow),
      }));
    }
    if (query.published === 'true') return this.process.listPublished(user.tenantId);
    return this.process.list(user.tenantId, query);
  }

  /** Una tarjeta por proceso; el historial se carga solo cuando se necesita. */
  @Roles('admin')
  @Get('process-catalog')
  catalog(@CurrentUser() user: AuthenticatedUser) {
    return this.process.catalog(user.tenantId);
  }

  @Roles('admin')
  @Post('process-packages/import')
  importPackage(@Body() body: ImportProcessPackageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.importPackage(user.tenantId, body);
  }

  @Roles('admin')
  @Get('process-definitions/:key/export')
  exportPackage(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.process.exportPackage(key, user.tenantId);
  }

  @Roles('admin')
  @Get('process-definitions/:key/impact')
  impact(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.process.impact(key, user.tenantId);
  }

  @Roles('admin')
  @Post('process-definitions/:key/preview-flow')
  previewFlow(@Param('key') key: string, @Body() body: PreviewFlowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.previewFlow(key, user.tenantId, user.actorId, body);
  }

  @Roles('admin')
  @Get('process-definitions/:key/versions')
  versions(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.process.versions(key, user.tenantId);
  }

  @Roles('admin')
  @Get('process-definitions/:key/versions/:version')
  version(@Param('key') key: string, @Param('version', ParseIntPipe) version: number, @CurrentUser() user: AuthenticatedUser) {
    return this.process.getVersion(key, version, user.tenantId);
  }

  @Roles('admin')
  @Post('process-definitions/:key/versions/:version/restore')
  restore(@Param('key') key: string, @Param('version', ParseIntPipe) version: number, @CurrentUser() user: AuthenticatedUser) {
    return this.process.restore(key, version, user.tenantId);
  }

  @Roles('admin')
  @Delete('process-definitions/:key')
  archive(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.process.archive(key, user.tenantId);
  }

  @Roles('admin')
  @Post('process-definitions/:key/unarchive')
  unarchive(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.process.unarchive(key, user.tenantId);
  }

  @Roles('admin')
  @Post('process-definitions/:key/preflight')
  preflight(@Param('key') key: string, @Body() body: PreflightDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.preflight(key, user.tenantId, body);
  }

  /** Valida un flujo sin guardarlo (mismos errores que al crearlo). */
  @Roles('admin')
  @Post('flows/validate')
  validateFlow(@Body() body: ValidateFlowDto) {
    const errors = validateFlow(body.flow);
    return { valid: errors.length === 0, errors };
  }

  /**
   * Convierte un diagrama BPMN (p. ej. el del modelador) en un flujo ejecutable, sin guardarlo.
   * Si no se puede, devuelve `flow: null` y los motivos en `errors`.
   */
  @Roles('admin')
  @Post('flows/from-bpmn')
  fromBpmn(@Body() body: FromBpmnDto) {
    const variables = (body.variables ?? []).filter((v): v is FlowVariable => typeof v === 'object' && v !== null);
    const { flow, errors, warnings } = bpmnToFlow(body.xml, { variables });
    return { flow: flow ?? null, errors, warnings };
  }

  @Roles('admin')
  @Post('process-definitions')
  create(@Body() body: CreateFlowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.createFromFlow(user.tenantId, body);
  }

  @Roles('admin')
  @Put('process-definitions/:key/flow')
  saveFlow(@Param('key') key: string, @Body() body: SaveFlowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.saveFlow(key, user.tenantId, body);
  }

  @Roles('admin')
  @Post('process-definitions/:key/versions/:version/publish')
  publish(@Param('key') key: string, @Param('version', ParseIntPipe) version: number, @CurrentUser() user: AuthenticatedUser) {
    return this.process.publish(key, version, user.tenantId);
  }

  @Roles('admin')
  @Post('process-definitions/:key/versions/:version/unpublish')
  unpublish(@Param('key') key: string, @Param('version', ParseIntPipe) version: number, @CurrentUser() user: AuthenticatedUser) {
    return this.process.unpublish(key, version, user.tenantId);
  }

  @Roles('admin')
  @Get('process-definitions/:key')
  get(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.process.getLatest(key, user.tenantId);
  }

  @Roles('admin')
  @Get('process-definitions/:key/bpmn')
  async bpmn(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    const def = await this.process.getLatest(key, user.tenantId);
    return { xml: def.bpmnXml, key: def.key, version: def.version, name: def.name };
  }

  @Roles('admin')
  @Get('process-definitions/:key/dmn')
  async dmn(@Param('key') key: string, @CurrentUser() user: AuthenticatedUser) {
    const def = await this.process.getLatest(key, user.tenantId);
    return { xml: def.dmnXml, key: def.key, version: def.version };
  }

  @Roles('admin')
  @Put('process-definitions/:key')
  save(@Param('key') key: string, @Body() body: SaveProcessDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.saveXml(key, user.tenantId, body);
  }

  @Post('process-definitions/:key/decide')
  decide(@Param('key') key: string, @Body() body: DecideDto, @CurrentUser() user: AuthenticatedUser) {
    return this.process.decide({ tipo: body.tipo ?? 'contrato', ...(body.context ?? {}) }, body.processKey ?? key, user.tenantId);
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
