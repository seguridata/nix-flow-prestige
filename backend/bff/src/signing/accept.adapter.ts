import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { SignCommand, SignResult, SignerAdapter } from './signer-adapter';

/**
 * ACCEPT — "Acepto" sobre el hash congelado: sin trazo, sin certificado, sin
 * PAdES. No incrusta nada en el PDF (no hay `signedPdf`): el canónico y la
 * copia presentada no se tocan.
 */
@Injectable()
export class AcceptSignerAdapter implements SignerAdapter {
  readonly method = 'ACCEPT' as const;

  capabilities() {
    return { configured: true };
  }

  async sign(command: SignCommand): Promise<SignResult> {
    const signatureHash = createHash('sha256')
      .update(`${command.documentHash}:${command.signerId}:ACCEPT`)
      .digest('hex');
    return {
      algorithm: 'SHA-256 sobre el hash congelado (sin trazo ni PAdES)',
      provider: 'prestige-accept',
      signatureHash,
    };
  }
}
