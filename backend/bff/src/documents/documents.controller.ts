import { Controller, Body, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { DocumentsService, type SafeDocument } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Public()
  @Post()
  create(
    @Body() body: { caseId: string; filename: string; contentBase64: string },
  ): Promise<SafeDocument> {
    return this.documents.create(body);
  }

  @Public()
  @Get()
  list(@Query('caseId') caseId?: string): Promise<SafeDocument[]> {
    return this.documents.list(caseId);
  }

  @Public()
  @Get(':id')
  async get(@Param('id') id: string): Promise<SafeDocument> {
    const { contentBase64, ...safe } = await this.documents.getOrThrow(id);
    return safe;
  }

  @Public()
  @Get(':id/content')
  async getContent(@Param('id') id: string, @Res() res: Response) {
    const found = await this.documents.getOrThrow(id);
    // TODO Fase 1: en vez de devolver el base64 aquí, regresar una URL
    // prefirmada de corta duración hacia el object storage (M03/M12).
    res.json({ id: found.id, hash: found.hash, contentBase64: found.contentBase64 });
  }
}
