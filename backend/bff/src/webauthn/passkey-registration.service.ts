import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { WebauthnConfig } from './webauthn.config';

const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Alta de passkeys para usuarios internos (Keycloak). El registro externo de
 * un firmante invitado no existe: su factor de presencia es el enlace de un
 * solo uso, no una cuenta.
 */
@Injectable()
export class PasskeyRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WebauthnConfig,
  ) {}

  async beginRegistration(user: AuthenticatedUser) {
    const existing = await this.prisma.passkeyCredential.findMany({
      where: { tenantId: user.tenantId, userId: user.actorId },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpID,
      userName: user.actorId,
      userDisplayName: user.name ?? user.actorId,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: Buffer.from(c.credentialId).toString('base64url'),
        transports: c.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    // Se persiste el challenge que la librería ya codificó (`options.challenge`),
    // nunca uno recalculado — mismo motivo que en PasskeyCeremonyService.
    await this.prisma.passkeyRegistrationChallenge.create({
      data: {
        tenantId: user.tenantId,
        userId: user.actorId,
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });

    return options;
  }

  async finishRegistration(user: AuthenticatedUser, response: RegistrationResponseJSON) {
    const pending = await this.prisma.passkeyRegistrationChallenge.findFirst({
      where: { tenantId: user.tenantId, userId: user.actorId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) {
      throw new NotFoundException('No hay un registro de passkey en curso; pide un challenge nuevo');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID,
    });
    // El challenge es de un solo uso incluso si la verificación falla: un
    // reintento pide uno nuevo, no reutiliza el mismo.
    await this.prisma.passkeyRegistrationChallenge.delete({ where: { id: pending.id } });

    if (!verification.verified || !verification.registrationInfo) {
      throw new ForbiddenException('El registro de la passkey falló');
    }

    const { credential } = verification.registrationInfo;
    return this.prisma.passkeyCredential.create({
      data: {
        tenantId: user.tenantId,
        userId: user.actorId,
        credentialId: Buffer.from(credential.id, 'base64url'),
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
      },
      select: { id: true, transports: true, createdAt: true },
    });
  }
}
