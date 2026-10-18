import { Module } from '@nestjs/common';
import { ControlPlaneController } from './control-plane.controller';
import { ControlPlaneService } from './control-plane.service';
import { SloService } from './slo.service';

@Module({
  controllers: [ControlPlaneController],
  providers: [ControlPlaneService, SloService],
  exports: [ControlPlaneService],
})
export class ControlPlaneModule {}
