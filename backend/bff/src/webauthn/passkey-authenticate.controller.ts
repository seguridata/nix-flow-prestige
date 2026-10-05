import { Body, Controller, Post } from '@nestjs/common';
import { IsDefined, IsObject, IsString, IsUUID } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PasskeyCeremonyService } from './passkey-ceremony.service';

export class PasskeyAuthBeginDto {
  @IsUUID()
  signatureRequestId!: string;
}

export class PasskeyAuthFinishDto {
  @IsString()
  assertionId!: string;

  @IsObject()
  @IsDefined()
  response!: Record<string, unknown>;
}

/**
 * Passkey para firmantes INTERNOS (JWT de Keycloak, sin `@Public()`).
 *
 * Contrato para el frontend:
 *  1. POST /webauthn/authenticate/begin  { signatureRequestId }
 *     -> { assertionId, options }. `options` va a `startAuthentication()`
 *        (userVerification 'required'; allowCredentials = passkeys del usuario).
 *  2. POST /webauthn/authenticate/finish { assertionId, response }
 *     con `response` = resultado de `startAuthentication()` -> { ok: true }.
 *  3. Enviar `passkeyAssertionId = assertionId` en `POST /signature-requests/:id/sign`
 *     (con method PASSKEY, o con cualquier método si la solicitud tiene
 *     requirePasskey). La aserción es de un solo uso, vence a los 5 min y
 *     solo sirve para esta solicitud y para este usuario.
 */
@Controller('webauthn/authenticate')
export class PasskeyAuthenticateController {
  constructor(private readonly ceremony: PasskeyCeremonyService) {}

  @Post('begin')
  begin(@CurrentUser() user: AuthenticatedUser, @Body() body: PasskeyAuthBeginDto) {
    return this.ceremony.beginForUser(user, body.signatureRequestId);
  }

  @Post('finish')
  finish(@CurrentUser() user: AuthenticatedUser, @Body() body: PasskeyAuthFinishDto) {
    return this.ceremony.finish({
      assertionId: body.assertionId,
      response: body.response as unknown as AuthenticationResponseJSON,
      expectedSignerId: user.actorId,
      expectedTenantId: user.tenantId,
    });
  }
}
