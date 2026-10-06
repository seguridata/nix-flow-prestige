import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { FoldersService, type DriveContents } from './folders.service';

class ContentsQueryDto {
  @IsOptional()
  @IsUUID()
  folderId?: string;
}

class CreateFolderDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
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
  constructor(private readonly folders: FoldersService) {}

  @Get('contents')
  contents(@Query() q: ContentsQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<DriveContents> {
    return this.folders.contents(q.folderId ?? null, actorOf(user));
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
}
