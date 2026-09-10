import { Global, Module } from '@nestjs/common';
import { CollaborationController } from './collaboration.controller';
import { CollaborationService } from './collaboration.service';
import { AuditChainService } from './audit-chain.service';

@Global()
@Module({
  controllers: [CollaborationController],
  providers: [CollaborationService, AuditChainService],
  exports: [CollaborationService, AuditChainService],
})
export class CollaborationModule {}
