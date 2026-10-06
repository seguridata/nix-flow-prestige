import { Type } from 'class-transformer';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { DocumentTemplatesService } from './document-templates.service';
import type { TemplateActor } from './template.types';

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

class ListQueryDto {
  /** `true` → el admin ve también los borradores. */
  @IsOptional() @IsIn(['true', 'false'])
  all?: string;
}

/** Edición: los campos que no vengan conservan su valor actual. La validación fina está en `parseTemplateMeta`. */
export class UpdateTemplateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  // `@Type(() => Object)`: con enableImplicitConversion, class-transformer convertiría cada elemento
  // de un `unknown[]` en un Array y `parseTemplateMeta` dejaría de verlos como objetos.
  @IsOptional() @IsArray() @Type(() => Object) fields?: unknown[];
  @IsOptional() @IsArray() @Type(() => Object) signatureBoxes?: unknown[];
  @IsOptional() @IsObject() flow?: Record<string, unknown>;
  @IsOptional() @IsArray() methods?: string[];
  @IsOptional() @IsString() kycPolicy?: string;
  @IsOptional() @IsBoolean() requirePasskey?: boolean;
  @IsOptional() @IsString() @MaxLength(120) flowKey?: string;
  @IsOptional() @IsInt() flowVersion?: number;
}

class PreviewDto {
  @IsObject() values!: Record<string, unknown>;
}

class InstantiateDto {
  @IsObject() values!: Record<string, string | number>;
  @IsOptional() @IsObject() askedSigners?: Record<string, { signerId: string; name?: string; email?: string }>;
  @IsOptional() @IsUUID() folderId?: string;
  @IsOptional() @IsUUID() caseId?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
}

const actorOf = (u: AuthenticatedUser): TemplateActor => ({
  tenantId: u.tenantId,
  actorId: u.actorId,
  name: u.name,
  email: u.email,
  isAdmin: u.roles.includes('admin'),
});

/**
 * Formatos: PDF base + campos que el usuario llena + flujo de firma precargado.
 * Administrar es de `admin`; consultar y usar (instanciar) es de cualquier usuario autenticado,
 * así un empleado sin rol de remitente puede enviar su formato de vacaciones.
 */
@Controller('document-templates')
export class DocumentTemplatesController {
  constructor(private readonly templates: DocumentTemplatesService) {}

  @Get()
  list(@Query() q: ListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.list(actorOf(user), q.all === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.get(id, actorOf(user));
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    const { bytes, filename } = await this.templates.getPdf(id, actorOf(user));
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Length', bytes.length)
      .setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`)
      .setHeader('Cache-Control', 'private, no-store')
      .end(bytes);
  }

  @Get(':id/bpmn')
  bpmn(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.bpmn(id, actorOf(user));
  }

  /** Multipart: `file` (PDF base) + `meta` (JSON en texto). */
  @Roles('admin')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_TEMPLATE_BYTES } }))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('meta') meta: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(meta ?? '');
    } catch {
      throw new BadRequestException('El campo «meta» debe ser un JSON válido');
    }
    return this.templates.create(parsed, file, actorOf(user));
  }

  @Roles('admin')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.update(id, body, actorOf(user));
  }

  @Roles('admin')
  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.setPublished(id, true, actorOf(user));
  }

  @Roles('admin')
  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.setPublished(id, false, actorOf(user));
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.templates.remove(id, actorOf(user));
  }

  @Post(':id/preview-flow')
  preview(@Param('id') id: string, @Body() body: PreviewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.previewFlow(id, body.values, actorOf(user));
  }

  @Post(':id/instantiate')
  instantiate(@Param('id') id: string, @Body() body: InstantiateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.instantiate(id, body, actorOf(user));
  }
}
