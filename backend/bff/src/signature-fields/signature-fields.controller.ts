import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { SignatureFieldsService, type SignatureFieldInput } from './signature-fields.service';

@Controller('signature-fields')
export class SignatureFieldsController {
  constructor(private readonly signatureFields: SignatureFieldsService) {}

  @Roles('sender', 'admin')
  @Post()
  create(@Body() body: SignatureFieldInput, @CurrentUser() user: AuthenticatedUser) {
    return this.signatureFields.create(body, user.tenantId);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('documentId') documentId?: string) {
    if (!documentId) throw new BadRequestException('documentId es requerido');
    return this.signatureFields.listByDocument(documentId, user.tenantId);
  }

  @Roles('sender', 'admin')
  @Post('bulk')
  bulk(
    @Body() body: { documentId: string; fields: SignatureFieldInput[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.signatureFields.createMany(body.documentId, body.fields ?? [], user.tenantId);
  }

  @Roles('sender', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.signatureFields.remove(id, user.tenantId);
  }
}
