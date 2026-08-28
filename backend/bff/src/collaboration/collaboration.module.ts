import { Global, Module } from '@nestjs/common';
import { CollaborationController } from './collaboration.controller';
import { CollaborationService } from './collaboration.service';

@Global()
@Module({
  controllers: [CollaborationController],
  providers: [CollaborationService],
  exports: [CollaborationService],
})
export class CollaborationModule {}
