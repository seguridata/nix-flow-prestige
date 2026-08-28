import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { OnboardingService } from './onboarding.service';
import type { OnboardingKind } from '@prisma/client';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @Get()
  list() {
    return this.onboarding.list();
  }

  @Public()
  @Post()
  create(
    @Body()
    body: {
      kind?: OnboardingKind;
      fullName: string;
      email: string;
      curp?: string;
      rfc?: string;
      requestedBy: string;
      requestedByName?: string;
    },
  ) {
    return this.onboarding.create(body);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.onboarding.get(id);
  }

  @Public()
  @Post(':id/ine')
  ine(
    @Param('id') id: string,
    @Body() body: { frontBase64?: string; backBase64?: string; actorId: string; actorName?: string },
  ) {
    return this.onboarding.attachIne(id, body);
  }

  @Public()
  @Post(':id/liveness')
  liveness(
    @Param('id') id: string,
    @Body() body: { selfieBase64: string; actorId: string; actorName?: string },
  ) {
    return this.onboarding.captureLiveness(id, body);
  }

  @Public()
  @Post(':id/actions/verify-ine')
  verify(
    @Param('id') id: string,
    @Body() body: { actorId: string; actorName?: string; notes?: string },
  ) {
    return this.onboarding.verifyIne(id, body);
  }

  @Public()
  @Post(':id/actions/enable')
  enable(@Param('id') id: string, @Body() body: { actorId: string; actorName?: string }) {
    return this.onboarding.enable(id, body);
  }

  @Public()
  @Post(':id/actions/reject')
  reject(
    @Param('id') id: string,
    @Body() body: { actorId: string; actorName?: string; notes?: string },
  ) {
    return this.onboarding.reject(id, body);
  }
}
