import { Module } from '@nestjs/common';
import { SigningModule } from '../signing/signing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { IdentityModule } from '../identity/identity.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { KeycloakAdminService } from './keycloak-admin.service';

@Module({
  imports: [SigningModule, WebhooksModule, IdentityModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, KeycloakAdminService],
})
export class OnboardingModule {}
