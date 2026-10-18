import { BadRequestException, Injectable } from '@nestjs/common';
import type { SignatureMethod } from '@prisma/client';
import { AcceptSignerAdapter } from './accept.adapter';
import { AutographSignerAdapter } from './autograph.adapter';
import { BiometricSignerAdapter } from './biometric.adapter';
import { DigitalSignerAdapter } from './digital.adapter';
import { PasskeySignerAdapter } from './passkey.adapter';
import type {
  ReconcileResult,
  SignCommand,
  SignResult,
  SignerAdapter,
  VerifyResult,
} from './signer-adapter';

@Injectable()
export class SigningRouter {
  private readonly byMethod: Record<SignatureMethod, SignerAdapter>;

  constructor(
    digital: DigitalSignerAdapter,
    autograph: AutographSignerAdapter,
    biometric: BiometricSignerAdapter,
    accept: AcceptSignerAdapter,
    passkey: PasskeySignerAdapter,
  ) {
    this.byMethod = {
      DIGITAL: digital,
      AUTOGRAFA: autograph,
      BIOMETRICA: biometric,
      ACCEPT: accept,
      PASSKEY: passkey,
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

  /** Fase B — consulta el estado de una firma `pending` del método dado. */
  async reconcile(
    method: SignatureMethod,
    pendingRef: string,
    command: SignCommand,
  ): Promise<ReconcileResult> {
    const adapter = this.byMethod[method];
    if (!adapter?.reconcile) return { status: 'failed', reason: `El método ${method} no soporta reconciliación` };
    return adapter.reconcile(pendingRef, command);
  }

  /** Verifica la firma criptográfica embebida en un PDF (hoy: PAdES/DIGITAL). */
  async verifyPdf(pdfBytes: Buffer): Promise<VerifyResult> {
    const digital = this.byMethod.DIGITAL;
    return digital.verify
      ? digital.verify(pdfBytes)
      : { valid: false, reason: 'Sin verificador disponible', signatures: 0 };
  }
}
