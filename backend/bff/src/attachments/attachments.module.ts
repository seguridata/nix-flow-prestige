import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AttachmentsService } from './attachments.service';

/** ADR-008 §7 — anexos de formatos. PrismaService, RedisService, StorageService y CollaborationService son globales. */
@Module({
  imports: [DocumentsModule],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
