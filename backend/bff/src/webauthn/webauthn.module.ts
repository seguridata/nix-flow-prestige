import { Module } from '@nestjs/common';
import { WebauthnConfig } from './webauthn.config';
import { PasskeyRegistrationService } from './passkey-registration.service';
import { PasskeyRegistrationController } from './passkey-registration.controller';
import { PasskeyCeremonyService } from './passkey-ceremony.service';

@Module({
  controllers: [PasskeyRegistrationController],
  providers: [WebauthnConfig, PasskeyRegistrationService, PasskeyCeremonyService],
  exports: [WebauthnConfig, PasskeyCeremonyService],
})
export class WebauthnModule {}
