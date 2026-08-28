import { Module } from '@nestjs/common';
import { SigningModule } from '../signing/signing.module';
import { OperationsController } from './operations.controller';

@Module({
  imports: [SigningModule],
  controllers: [OperationsController],
})
export class OperationsModule {}
