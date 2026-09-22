import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { DocumentsService, type SafeDocument } from './documents.service';
import { CreateDocumentDto, ListDocumentsQueryDto } from './dto';

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * Alta de documento por `multipart/form-data`: campo `file` (el PDF) +
   * campo `caseId` (+ `filename` opcional). El PDF se cifra y se guarda en
   * object storage; nunca viaja ni se persiste como base64.
   */
  @Roles('sender', 'admin')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }))
  create(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'application/pdf' })
        .addMaxSizeValidator({ maxSize: MAX_PDF_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SafeDocument> {
    return this.documents.create({
      caseId: dto.caseId,
      filename: dto.filename ?? file.originalname ?? 'documento.pdf',
      bytes: file.buffer,
      tenantId: user.tenantId,
    });
  }

  @Get()
  list(
    @Query() query: ListDocumentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SafeDocument[]> {
    return this.documents.list(query.caseId, user.tenantId);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<SafeDocument> {
    return this.documents.get(id, user.tenantId);
  }

  /** Sirve el PDF descifrado (no una URL prefirmada: el objeto está cifrado a nivel app). */

  @Get(':id/content')
  async getContent(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const { bytes, mimeType, filename } = await this.documents.getContent(id, user.tenantId);
    res
      .status(200)
      .setHeader('Content-Type', mimeType)
      .setHeader('Content-Length', bytes.length)
      .setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`)
      .setHeader('Cache-Control', 'private, no-store')
      .end(bytes);
  }
}
