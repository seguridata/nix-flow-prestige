import { Module } from '@nestjs/common';
import { FlowResolverService } from './flow-resolver.service';
import { LookupTablesController } from './lookup-tables.controller';
import { LookupTablesService } from './lookup-tables.service';

@Module({
  controllers: [LookupTablesController],
  providers: [LookupTablesService, FlowResolverService],
  exports: [FlowResolverService],
})
export class LookupTablesModule {}
