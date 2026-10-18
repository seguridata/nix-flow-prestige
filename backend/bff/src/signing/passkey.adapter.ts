import { BadRequestException, Injectable } from '@nestjs/common';
import type { SignCommand, SignResult, SignerAdapter } from './signer-adapter';
import { PasskeyCeremonyService } from '../webauthn/passkey-ceremony.service';

/**
 * PASSKEY — verificación de presencia WebAuthn. No produce PAdES ni incrusta
 * nada en el PDF (SPEC P1 §8): la aserción ya se verificó en
 * `/passkey/finish`; aquí solo se GASTA, atómicamente, para que no sirva
 * para una segunda firma.
 */
@Injectable()
export class PasskeySignerAdapter implements SignerAdapter {
  readonly method = 'PASSKEY' as const;

  constructor(private readonly ceremony: PasskeyCeremonyService) {}

  capabilities() {
    return { configured: true };
  }

  async sign(command: SignCommand): Promise<SignResult> {
    if (!command.passkeyAssertionId) {
      throw new BadRequestException('Falta `passkeyAssertionId`: primero hay que completar /passkey/finish');
    }
    const { credentialId } = await this.ceremony.consume({
      assertionId: command.passkeyAssertionId,
      tenantId: command.tenantId,
      signatureRequestId: command.signatureRequestId,
      signerId: command.signerId,
    });
    return {
      algorithm: 'WebAuthn (verificación de presencia; no produce PAdES)',
      provider: `passkey:${credentialId.slice(0, 12)}…`,
      signatureHash: command.documentHash,
    };
  }
}
