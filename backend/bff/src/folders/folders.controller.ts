import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { DriveItemsService } from './drive-items.service';
import { FoldersService, type DriveContents } from './folders.service';

class ContentsQueryDto {
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

class SearchCasesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

class CreateFolderDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

class CopyCaseDto {
  /** Carpeta destino; ausente o `null` = raíz. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  folderId?: string | null;
}

class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** `null` mueve a la raíz. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId?: string | null;
}

const actorOf = (u: AuthenticatedUser) => ({ tenantId: u.tenantId, ownerId: u.actorId });

/** "Mis documentos": carpetas personales (sin compartir) de cualquier usuario autenticado. */
@Controller('drive')
export class FoldersController {
  constructor(
    private readonly folders: FoldersService,
    private readonly items: DriveItemsService,
  ) {}

  @Get('contents')
  contents(@Query() q: ContentsQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<DriveContents> {
    return this.folders.contents(q.folderId ?? null, actorOf(user), { limit: q.limit, cursor: q.cursor });
  }

  @Get('cases')
  cases(@Query() q: SearchCasesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.folders.searchCases(q.q, actorOf(user));
  }

  @Post('folders')
  create(@Body() body: CreateFolderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.folders.create(body.name, body.parentId ?? null, actorOf(user));
  }

  @Patch('folders/:id')
  update(@Param('id') id: string, @Body() body: UpdateFolderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.folders.update(id, body, actorOf(user));
  }

  @Delete('folders/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.folders.remove(id, actorOf(user));
  }

  /** Copia un expediente o documento suelto a otra carpeta (copiar y pegar). */
  @Roles('sender', 'admin')
  @Post('cases/:id/copy')
  copyCase(@Param('id') id: string, @Body() body: CopyCaseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.items.copyCase(id, body.folderId ?? null, { ...actorOf(user), actorName: user.name });
  }

  /** Elimina un borrador; con solicitud de firma, evidencia o comentarios responde 409. */
  @Roles('sender', 'admin')
  @Delete('cases/:id')
  @HttpCode(204)
  async removeCase(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.items.removeCase(id, actorOf(user));
  }
}
