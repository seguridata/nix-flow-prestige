import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { LookupTablesModule } from '../lookup-tables/lookup-tables.module';
import { DocumentsModule } from '../documents/documents.module';
import { FoldersModule } from '../folders/folders.module';
import { SignatureFieldsModule } from '../signature-fields/signature-fields.module';
import { SignatureRequestsModule } from '../signature-requests/signature-requests.module';
import { SigningModule } from '../signing/signing.module';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';

@Module({
  imports: [AttachmentsModule, LookupTablesModule, DocumentsModule, FoldersModule, SignatureFieldsModule, SignatureRequestsModule, SigningModule],
  controllers: [DocumentTemplatesController],
  providers: [DocumentTemplatesService],
  exports: [DocumentTemplatesService],
})
export class DocumentTemplatesModule {}
