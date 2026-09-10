import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { SignatureFieldsService, type SignatureFieldInput } from './signature-fields.service';

@Controller('signature-fields')
export class SignatureFieldsController {
  constructor(private readonly signatureFields: SignatureFieldsService) {}

  @Roles('sender', 'admin')
  @Post()
  create(@Body() body: SignatureFieldInput) {
    return this.signatureFields.create(body);
  }

  @Get()
  list(@Query('documentId') documentId?: string) {
    if (!documentId) throw new BadRequestException('documentId es requerido');
    return this.signatureFields.listByDocument(documentId);
  }

  @Roles('sender', 'admin')
  @Post('bulk')
  bulk(@Body() body: { documentId: string; fields: SignatureFieldInput[] }) {
    return this.signatureFields.createMany(body.documentId, body.fields ?? []);
  }

  @Roles('sender', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.signatureFields.remove(id);
  }
}
