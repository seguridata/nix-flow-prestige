import { ServiceUnavailableException, Injectable } from '@nestjs/common';
import type { SignCommand, SignResult, SignerAdapter } from './signer-adapter';

/**
 * Entorno listo para un motor biométrico de pago (SeguriData 3D / INE).
 * Sin BIOMETRIC_PROVIDER_URL no se llama a terceros.
 */
@Injectable()
export class BiometricSignerAdapter implements SignerAdapter {
  readonly method = 'BIOMETRICA' as const;

  capabilities() {
    const url = process.env.BIOMETRIC_PROVIDER_URL?.trim();
    if (!url) {
      return {
        configured: false,
        reason: 'BIOMETRIC_PROVIDER_URL vacío — el entorno está preparado, el proveedor se conecta al final',
      };
    }
    return { configured: true };
  }

  async sign(command: SignCommand): Promise<SignResult> {
    const caps = this.capabilities();
    if (!caps.configured) {
      throw new ServiceUnavailableException(
        'Firma biométrica pendiente de proveedor. Configura BIOMETRIC_PROVIDER_URL y BIOMETRIC_API_KEY.',
      );
    }
    const url = process.env.BIOMETRIC_PROVIDER_URL as string;
    const res = await fetch(`${url.replace(/\/$/, '')}/sessions/${command.biometricSessionId ?? 'latest'}/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.BIOMETRIC_API_KEY ?? ''}`,
      },
      body: JSON.stringify({ signerId: command.signerId, documentHash: command.documentHash }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Proveedor biométrico respondió ${res.status}`);
    }
    const body = (await res.json()) as { signatureHash?: string };
    return {
      algorithm: 'BIOMETRIC-LIVENESS',
      signatureHash: body.signatureHash ?? command.documentHash,
      provider: url,
    };
  }
}
