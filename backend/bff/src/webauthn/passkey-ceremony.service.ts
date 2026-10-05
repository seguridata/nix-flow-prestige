import { randomBytes, createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
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
      where: {
        tenantId: request.tenantId,
        // El registro interno guarda `userId` (= actorId); `signerId` queda
        // para credenciales atadas a un firmante externo. Se aceptan ambos.
        OR: [{ userId: params.signerId }, { signerId: params.signerId }],
      },
      select: { credentialId: true, transports: true },
    });
    // Un firmante externo sin passkey registrada llega aquí con la lista
    // vacía: el navegador simplemente no encontrará credencial que ofrecer, y
    // `finish` nunca se llega a invocar. No es un caso de error de `begin`.

    const options = await generateAuthenticationOptions({
      rpID: this.config.rpID,
      userVerification: 'required',
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

  /**
   * Variante autenticada (firmante interno): el firmante ES `user.actorId`
   * (o el delegado de un firmante). Solo emite el challenge si la solicitud es
   * del tenant del usuario y el usuario figura como firmante/delegado.
   */
  async beginForUser(user: { actorId: string; tenantId: string }, signatureRequestId: string) {
    const request = await this.prisma.signatureRequest.findFirst({
      where: { id: signatureRequestId, tenantId: user.tenantId },
      include: { signers: true },
    });
    if (!request) throw new NotFoundException('Solicitud de firma no encontrada');
    const isSigner = request.signers.some(
      (s) => s.signerId === user.actorId || s.delegatedTo === user.actorId,
    );
    if (!isSigner) throw new ForbiddenException('No eres firmante de esta solicitud');
    return this.begin({ signatureRequestId, signerId: user.actorId });
  }

  async finish(params: {
    assertionId: string;
    response: AuthenticationResponseJSON;
    /** Si se pasa, la aserción debe ser de este firmante (lo usa el endpoint autenticado). */
    expectedSignerId?: string;
    expectedTenantId?: string;
  }) {
    const assertion = await this.prisma.passkeyAssertion.findUnique({
      where: { id: params.assertionId },
    });
    if (!assertion) throw new NotFoundException('Verificación de passkey no encontrada');
    if (
      (params.expectedSignerId && assertion.signerId !== params.expectedSignerId) ||
      (params.expectedTenantId && assertion.tenantId !== params.expectedTenantId)
    ) {
      throw new NotFoundException('Verificación de passkey no encontrada');
    }
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
    // La credencial debe pertenecer al firmante de ESTA aserción: otra
    // passkey del mismo tenant no puede satisfacer la firma de alguien más.
    if (credential.userId !== assertion.signerId && credential.signerId !== assertion.signerId) {
      throw new ForbiddenException('La passkey no pertenece a este firmante');
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
    const storedCounter = Number(credential.counter);
    // Un contador que no avanza es la señal clásica de clon o reintento. Solo
    // se tolera 0 cuando el guardado también es 0 (autenticadores sin contador).
    if (newCounter <= storedCounter && !(newCounter === 0 && storedCounter === 0)) {
      throw new ConflictException({
        error: 'PASSKEY_REPLAY',
        message: 'El contador de la passkey no avanzó: posible reintento o clon',
      });
    }

    // Avance ATÓMICO del contador: dos finish concurrentes con la misma
    // aserción del autenticador no pueden pasar ambos (solo uno ve count 1).
    if (newCounter > 0) {
      const advanced = await this.prisma.passkeyCredential.updateMany({
        where: { id: credential.id, counter: { lt: BigInt(newCounter) } },
        data: { counter: BigInt(newCounter) },
      });
      if (advanced.count !== 1) {
        throw new ConflictException({
          error: 'PASSKEY_REPLAY',
          message: 'El contador de la passkey no avanzó: posible reintento o clon',
        });
      }
    }
    // Reclamo único de la aserción: si otra petición la resolvió mientras
    // tanto, esta pierde.
    const claimed = await this.prisma.passkeyAssertion.updateMany({
      where: { id: assertion.id, verifiedAt: null, consumedAt: null },
      data: { verifiedAt: new Date(), credentialId },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Esta verificación de passkey ya se resolvió');
    }

    await this.collab.audit({
      signatureRequestId: assertion.signatureRequestId,
      actorId: assertion.signerId,
      action: 'PASSKEY_ASSERTED',
      payload: { credentialId: params.response.id, counter: newCounter },
    });

    return { ok: true as const };
  }

  /**
   * Gasta una aserción ya verificada. `signerId` debe ser el firmante ACTUANTE
   * (el mismo con el que se hizo `begin`: actorId del usuario / signerId del
   * enlace), no el firmante original cuando hay delegación.
   * Un solo `updateMany` con todas las
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
