import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { DriveItemsService } from './drive-items.service';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';

@Module({
  imports: [DocumentsModule],
  controllers: [FoldersController],
  providers: [FoldersService, DriveItemsService],
  exports: [FoldersService],
})
export class FoldersModule {}
