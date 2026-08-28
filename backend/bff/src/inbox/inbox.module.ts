import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { DocumentsModule } from '../documents/documents.module';
import { SignatureRequestsModule } from '../signature-requests/signature-requests.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [CasesModule, DocumentsModule, SignatureRequestsModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
