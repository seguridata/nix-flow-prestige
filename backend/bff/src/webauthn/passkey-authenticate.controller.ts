import { Body, ConflictException, Controller, Post } from '@nestjs/common';
import { IsDefined, IsObject, IsString, IsUUID } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PasskeyCeremonyService } from './passkey-ceremony.service';

/** Estados en los que la solicitud aún admite firma. */
const OPEN_STATUSES: string[] = ['PENDIENTE', 'EN_FIRMA'];

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
  constructor(
    private readonly ceremony: PasskeyCeremonyService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('begin')
  async begin(@CurrentUser() user: AuthenticatedUser, @Body() body: PasskeyAuthBeginDto) {
    // Una solicitud cerrada ya no admite firma: no se emite challenge. Si no
    // existe o es de otro tenant se deja a `beginForUser` (404 sin distinguir).
    const request = await this.prisma.signatureRequest.findFirst({
      where: { id: body.signatureRequestId, tenantId: user.tenantId },
      select: { status: true },
    });
    if (request && !OPEN_STATUSES.includes(request.status)) {
      throw new ConflictException({
        error: 'REQUEST_NOT_OPEN',
        message: `La solicitud ya está ${request.status}; no admite nuevas verificaciones de passkey`,
      });
    }
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
