import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { SignCommand, SignResult, SignerAdapter } from './signer-adapter';

/**
 * DIGITAL: HMAC interno hasta conectar HSM/PKI (M09).
 * El hash se deriva del documento + firmante; no se finge un PKCS#7.
 */
@Injectable()
export class DigitalSignerAdapter implements SignerAdapter {
  readonly method = 'DIGITAL' as const;

  capabilities() {
    return { configured: true, reason: 'Adaptador HMAC interno — sustituir por HSM/PKI' };
  }

  async sign(command: SignCommand): Promise<SignResult> {
    const secret = process.env.PRESTIGE_SIGNING_SECRET ?? 'prestige-dev-only';
    const signatureHash = createHmac('sha256', secret)
      .update(`${command.documentHash}:${command.signerId}:DIGITAL`)
      .digest('hex');
    return {
      algorithm: 'HMAC-SHA256',
      signatureHash,
      provider: 'prestige-digital-dev',
      detail: 'Pendiente de HSM/PKI de SeguriData',
    };
  }
}
