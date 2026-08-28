import { Module } from '@nestjs/common';
import { SignatureFieldsController } from './signature-fields.controller';
import { SignatureFieldsService } from './signature-fields.service';

@Module({
  controllers: [SignatureFieldsController],
  providers: [SignatureFieldsService],
  exports: [SignatureFieldsService],
})
export class SignatureFieldsModule {}
