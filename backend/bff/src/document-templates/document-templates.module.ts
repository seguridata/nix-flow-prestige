import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { FoldersModule } from '../folders/folders.module';
import { SignatureFieldsModule } from '../signature-fields/signature-fields.module';
import { SignatureRequestsModule } from '../signature-requests/signature-requests.module';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';

@Module({
  imports: [DocumentsModule, FoldersModule, SignatureFieldsModule, SignatureRequestsModule],
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
