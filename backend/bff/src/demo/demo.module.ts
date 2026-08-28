import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { DocumentsModule } from '../documents/documents.module';
import { SignatureRequestsModule } from '../signature-requests/signature-requests.module';
import { SignatureFieldsModule } from '../signature-fields/signature-fields.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [CasesModule, DocumentsModule, SignatureRequestsModule, SignatureFieldsModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
