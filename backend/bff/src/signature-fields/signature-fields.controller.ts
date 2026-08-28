import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { SignatureFieldsService, type SignatureFieldInput } from './signature-fields.service';

@Controller('signature-fields')
export class SignatureFieldsController {
  constructor(private readonly signatureFields: SignatureFieldsService) {}

  @Public()
  @Post()
  create(@Body() body: SignatureFieldInput) {
    return this.signatureFields.create(body);
  }

  @Public()
  @Get()
  list(@Query('documentId') documentId?: string) {
    if (!documentId) throw new BadRequestException('documentId es requerido');
    return this.signatureFields.listByDocument(documentId);
  }

  @Public()
  @Post('bulk')
  bulk(@Body() body: { documentId: string; fields: SignatureFieldInput[] }) {
    return this.signatureFields.createMany(body.documentId, body.fields ?? []);
  }

  @Public()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.signatureFields.remove(id);
  }
}
