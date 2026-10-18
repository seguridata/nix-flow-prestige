import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PageQueryDto, type Page } from '../common/pagination';
import { CasesService, type Case } from './cases.service';
import { AttachmentsService, type AttachmentListItem } from '../attachments/attachments.service';

class CreateCaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;

  /** Documento suelto: expediente implícito que la vista Drive muestra como documento. */
  @IsOptional()
  @IsBoolean()
  loose?: boolean;
}

class UpdateCaseDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  /** `null` mueve a la raíz de "Mis documentos". */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  folderId?: string | null;
}

class ListCasesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tenantId?: string;
}

@Controller('cases')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Roles('sender', 'admin')
  @Post()
  create(@Body() body: CreateCaseDto, @CurrentUser() user: AuthenticatedUser): Promise<Case> {
    return this.cases.create({
      tenantId: user.tenantId,
      title: body.title,
      ownerId: user.actorId,
      folderId: body.folderId,
      loose: body.loose,
    });
  }

  @Get()
  list(@Query() query: ListCasesQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<Case[] | Page<Case>> {
    return this.cases.list(user.tenantId, query);
  }

  @Roles('sender', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateCaseDto, @CurrentUser() user: AuthenticatedUser): Promise<Case> {
    return this.cases.update(id, body, { tenantId: user.tenantId, ownerId: user.actorId });
  }

  /**
   * ADR-008 — anexos del expediente `[{documentId, attachmentKey, filename, sizeBytes, mimeType, hash}]`. Solo el dueño
   * del expediente y los firmantes/destinatarios de sus solicitudes (404 para cualquier otro). La descarga usa
   * `GET /documents/:documentId/content`, con la misma regla.
   */
  @Get(':id/attachments')
  attachmentsOf(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<AttachmentListItem[]> {
    return this.attachments.listForCase(id, { tenantId: user.tenantId, actorId: user.actorId, name: user.name });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Case> {
    return this.cases.getOrThrow(id, user.tenantId);
  }
}
