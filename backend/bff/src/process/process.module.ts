import { Module } from '@nestjs/common';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';
import { LookupTablesModule } from '../lookup-tables/lookup-tables.module';

@Module({
  imports: [LookupTablesModule],
  controllers: [ProcessController],
  providers: [ProcessService],
  exports: [ProcessService],
})
export class ProcessModule {}
