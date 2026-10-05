import { Module } from '@nestjs/common';
import { WebauthnConfig } from './webauthn.config';
import { PasskeyRegistrationService } from './passkey-registration.service';
import { PasskeyRegistrationController } from './passkey-registration.controller';
import { PasskeyAuthenticateController } from './passkey-authenticate.controller';
import { PasskeyCeremonyService } from './passkey-ceremony.service';

@Module({
  controllers: [PasskeyRegistrationController, PasskeyAuthenticateController],
  providers: [WebauthnConfig, PasskeyRegistrationService, PasskeyCeremonyService],
  exports: [WebauthnConfig, PasskeyCeremonyService],
})
export class WebauthnModule {}
