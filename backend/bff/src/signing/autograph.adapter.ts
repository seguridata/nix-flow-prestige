import { createHash } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { SignCommand, SignResult, SignerAdapter } from './signer-adapter';

@Injectable()
export class AutographSignerAdapter implements SignerAdapter {
  readonly method = 'AUTOGRAFA' as const;

  capabilities() {
    return { configured: true };
  }

  async sign(command: SignCommand): Promise<SignResult> {
    if (!command.signatureImage?.length) {
      throw new BadRequestException('La firma autógrafa requiere el trazo capturado (campo `file`)');
    }
    const strokeHash = createHash('sha256').update(command.signatureImage).digest('hex');
    const signatureHash = createHash('sha256')
      .update(`${command.documentHash}:${strokeHash}`)
      .digest('hex');
    return {
      algorithm: 'SHA-256+STROKE',
      signatureHash,
      provider: 'signature_pad',
    };
  }
}
