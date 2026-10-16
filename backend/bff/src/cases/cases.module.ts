import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { FoldersModule } from '../folders/folders.module';
import { AttachmentsModule } from '../attachments/attachments.module';

@Module({
  imports: [FoldersModule, AttachmentsModule],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
