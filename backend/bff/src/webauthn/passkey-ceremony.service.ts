import { randomBytes, createHash } from 'node:crypto';
import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransport,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { WebauthnConfig } from './webauthn.config';

const ASSERTION_TTL_MS = 5 * 60_000;

/**
 * Ceremonia de verificación de presencia (WebAuthn) atada a una firma
 * concreta. El challenge = sha256(frozenHash || signatureRequestId || nonce)
 * (patrón de AGENTS.md): una aserción sirve para ESTA solicitud y ESTE hash,
 * no para "cualquier firma" del mismo firmante.
 */
@Injectable()
export class PasskeyCeremonyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collab: CollaborationService,
    private readonly config: WebauthnConfig,
  ) {}

  async begin(params: { signatureRequestId: string; signerId: string }) {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: params.signatureRequestId },
      include: { document: true },
    });
    if (!request) throw new NotFoundException('Solicitud de firma no encontrada');

    const nonce = randomBytes(16).toString('hex');
    const challengeBytes = createHash('sha256')
      .update(`${request.document.hash}|${request.id}|${nonce}`)
      .digest();

    const credentials = await this.prisma.passkeyCredential.findMany({
      where: { tenantId: request.tenantId, signerId: params.signerId },
      select: { credentialId: true, transports: true },
    });
    // Un firmante externo sin passkey registrada llega aquí con la lista
    // vacía: el navegador simplemente no encontrará credencial que ofrecer, y
    // `finish` nunca se llega a invocar. No es un caso de error de `begin`.

    const options = await generateAuthenticationOptions({
      rpID: this.config.rpID,
      userVerification: 'preferred',
      challenge: challengeBytes,
      allowCredentials: credentials.map((c) => ({
        id: Buffer.from(c.credentialId).toString('base64url'),
        transports: c.transports as AuthenticatorTransport[],
      })),
    });

    const assertion = await this.prisma.passkeyAssertion.create({
      data: {
        tenantId: request.tenantId,
        signatureRequestId: request.id,
        signerId: params.signerId,
        nonce,
        challengeHash: options.challenge,
        expiresAt: new Date(Date.now() + ASSERTION_TTL_MS),
      },
    });

    return { assertionId: assertion.id, options };
  }

  async finish(params: { assertionId: string; response: AuthenticationResponseJSON }) {
    const assertion = await this.prisma.passkeyAssertion.findUnique({
      where: { id: params.assertionId },
    });
    if (!assertion) throw new NotFoundException('Verificación de passkey no encontrada');
    if (assertion.verifiedAt || assertion.consumedAt) {
      throw new ConflictException('Esta verificación de passkey ya se resolvió');
    }
    if (assertion.expiresAt.getTime() < Date.now()) {
      throw new GoneException('La verificación de passkey expiró; pide un challenge nuevo');
    }

    const credentialId = Buffer.from(params.response.id, 'base64url');
    const credential = await this.prisma.passkeyCredential.findUnique({ where: { credentialId } });
    if (!credential || credential.tenantId !== assertion.tenantId) {
      throw new NotFoundException('Passkey no registrada para este firmante');
    }

    const verification = await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge: assertion.challengeHash,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID,
      credential: {
        id: params.response.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransport[],
      },
    });
    if (!verification.verified) {
      throw new ConflictException('La verificación de la passkey falló');
    }

    const newCounter = verification.authenticationInfo.newCounter;
    // Contador que no avanza (y no es 0 — algunos autenticadores no lo
    // soportan y siempre mandan 0) es la señal clásica de clon o reintento.
    if (newCounter !== 0 && newCounter <= Number(credential.counter)) {
      throw new ConflictException({
        error: 'PASSKEY_REPLAY',
        message: 'El contador de la passkey no avanzó: posible reintento o clon',
      });
    }

    await this.prisma.$transaction([
      this.prisma.passkeyCredential.update({
        where: { id: credential.id },
        data: { counter: newCounter },
      }),
      this.prisma.passkeyAssertion.update({
        where: { id: assertion.id },
        data: { verifiedAt: new Date(), credentialId },
      }),
    ]);

    await this.collab.audit({
      signatureRequestId: assertion.signatureRequestId,
      actorId: assertion.signerId,
      action: 'PASSKEY_ASSERTED',
      payload: { credentialId: params.response.id, counter: newCounter },
    });

    return { ok: true as const };
  }

  /**
   * Gasta una aserción ya verificada. Un solo `updateMany` con todas las
   * condiciones en el `where` es la comprobación Y el gasto: dos peticiones
   * concurrentes con el mismo `assertionId` no pueden ver ambas `count === 1`.
   */
  async consume(params: {
    assertionId: string;
    tenantId: string;
    signatureRequestId: string;
    signerId: string;
  }): Promise<{ credentialId: string }> {
    const updated = await this.prisma.passkeyAssertion.updateMany({
      where: {
        id: params.assertionId,
        tenantId: params.tenantId,
        signatureRequestId: params.signatureRequestId,
        signerId: params.signerId,
        verifiedAt: { not: null },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        error: 'PASSKEY_ASSERTION_INVALID',
        message: 'La verificación de passkey no existe, ya se usó, o no corresponde a esta firma',
      });
    }
    const row = await this.prisma.passkeyAssertion.findUniqueOrThrow({
      where: { id: params.assertionId },
    });
    return { credentialId: Buffer.from(row.credentialId!).toString('base64url') };
  }
}
