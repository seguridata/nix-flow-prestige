import { BadRequestException, Injectable } from '@nestjs/common';
import type { SignatureMethod } from '@prisma/client';
import { AutographSignerAdapter } from './autograph.adapter';
import { BiometricSignerAdapter } from './biometric.adapter';
import { DigitalSignerAdapter } from './digital.adapter';
import type { SignCommand, SignResult, SignerAdapter } from './signer-adapter';

@Injectable()
export class SigningRouter {
  private readonly byMethod: Record<SignatureMethod, SignerAdapter>;

  constructor(
    digital: DigitalSignerAdapter,
    autograph: AutographSignerAdapter,
    biometric: BiometricSignerAdapter,
  ) {
    this.byMethod = {
      DIGITAL: digital,
      AUTOGRAFA: autograph,
      BIOMETRICA: biometric,
    };
  }

  capabilities() {
    return (Object.keys(this.byMethod) as SignatureMethod[]).map((method) => ({
      method,
      ...this.byMethod[method].capabilities(),
    }));
  }

  sign(command: SignCommand): Promise<SignResult> {
    const adapter = this.byMethod[command.method];
    if (!adapter) throw new BadRequestException(`Método ${command.method} no soportado`);
    return adapter.sign(command);
  }
}
