import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ReconcileResult, SignCommand, SignResult, SignerAdapter } from './signer-adapter';

const BIOMETRIC_TIMEOUT_MS = 10_000;

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
    // Sin sesión explícita no hay forma de saber QUÉ verificación se está
    // usando: nunca se cae a una sesión «latest» del proveedor.
    const sessionId = command.biometricSessionId?.trim();
    if (!sessionId) {
      throw new BadRequestException('biometricSessionId es requerido para la firma biométrica');
    }
    const url = process.env.BIOMETRIC_PROVIDER_URL as string;
    const res = await fetch(`${url.replace(/\/$/, '')}/sessions/${encodeURIComponent(sessionId)}/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.BIOMETRIC_API_KEY ?? ''}`,
      },
      body: JSON.stringify({ signerId: command.signerId, documentHash: command.documentHash }),
      signal: AbortSignal.timeout(BIOMETRIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Proveedor biométrico respondió ${res.status}`);
    }
    const body = (await res.json()) as {
      status?: 'completed' | 'pending';
      ref?: string;
      signatureHash?: string;
      detail?: string;
      /** Si el proveedor los devuelve, se contrastan con el firmante/documento reales. */
      signerId?: string;
      documentHash?: string;
    };

    // La sesión debe ser DE ESTE firmante y DE ESTE documento (cuando el
    // proveedor lo informa): evita reutilizar la sesión de otra persona/PDF.
    if (body.signerId !== undefined && body.signerId !== command.signerId) {
      throw new UnprocessableEntityException('La sesión biométrica no pertenece al firmante');
    }
    if (body.documentHash !== undefined && body.documentHash !== command.documentHash) {
      throw new UnprocessableEntityException('La sesión biométrica no corresponde a este documento');
    }

    // El proveedor puede responder de forma ASÍNCRONA: `pending` + `ref`. La
    // firma queda a la espera y el reconciliador la cierra con `reconcile()`.
    if (body.status === 'pending' && body.ref) {
      return {
        algorithm: 'BIOMETRIC-LIVENESS',
        provider: url,
        signatureHash: command.documentHash,
        pending: true,
        pendingRef: body.ref,
        detail: body.detail,
      };
    }

    if (body.status === 'completed') {
      return {
        algorithm: 'BIOMETRIC-LIVENESS',
        signatureHash: body.signatureHash ?? command.documentHash,
        provider: url,
      };
    }

    // Cualquier otro estado (failed, rejected, ausente) es un rechazo — nunca
    // se trata como firma exitosa.
    throw new UnprocessableEntityException(
      body.detail ?? `Verificación biométrica no exitosa (status: ${body.status ?? 'desconocido'})`,
    );
  }

  async reconcile(pendingRef: string, command: SignCommand): Promise<ReconcileResult> {
    const url = process.env.BIOMETRIC_PROVIDER_URL?.trim();
    if (!url) return { status: 'failed', reason: 'BIOMETRIC_PROVIDER_URL no configurado' };
    const res = await fetch(`${url.replace(/\/$/, '')}/operations/${encodeURIComponent(pendingRef)}`, {
      headers: { authorization: `Bearer ${process.env.BIOMETRIC_API_KEY ?? ''}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { status: 'pending' };
    if (!res.ok) return { status: 'pending', reason: `proveedor respondió ${res.status}` };
    const b = (await res.json()) as {
      status?: 'completed' | 'failed' | 'pending';
      signatureHash?: string;
      reason?: string;
    };
    if (b.status === 'completed') {
      return { status: 'completed', signatureHash: b.signatureHash ?? command.documentHash };
    }
    if (b.status === 'failed') return { status: 'failed', reason: b.reason };
    return { status: 'pending' };
  }
}
