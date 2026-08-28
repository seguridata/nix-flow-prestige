import { Module } from '@nestjs/common';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';

@Module({
  controllers: [ProcessController],
  providers: [ProcessService],
  exports: [ProcessService],
})
export class ProcessModule {}
