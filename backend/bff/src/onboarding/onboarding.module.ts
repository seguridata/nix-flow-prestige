import { Module } from '@nestjs/common';
import { SigningModule } from '../signing/signing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [SigningModule, WebhooksModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
