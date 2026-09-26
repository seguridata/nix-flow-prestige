import { Body, Controller, Post } from '@nestjs/common';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PasskeyRegistrationService } from './passkey-registration.service';

/** Registro de passkeys para usuarios internos. Requiere el JWT de Keycloak — sin `@Public()`. */
@Controller('webauthn/register')
export class PasskeyRegistrationController {
  constructor(private readonly registration: PasskeyRegistrationService) {}

  @Post('begin')
  begin(@CurrentUser() user: AuthenticatedUser) {
    return this.registration.beginRegistration(user);
  }

  @Post('finish')
  finish(@CurrentUser() user: AuthenticatedUser, @Body() response: RegistrationResponseJSON) {
    return this.registration.finishRegistration(user, response);
  }
}
