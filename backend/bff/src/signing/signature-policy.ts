import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SignatureMethodName = 'DIGITAL' | 'AUTOGRAFA' | 'BIOMETRICA' | 'ACCEPT' | 'PASSKEY';

export interface SignaturePolicy {
  /** Versión de la política (del `Policy` del tenant, o 0 = por defecto). */
  version: number;
  source: 'tenant' | 'default';
  /** Métodos permitidos; una solicitud no puede autorizar otros. */
  allowedMethods: SignatureMethodName[];
  /** SLA por defecto si la solicitud no lo indica. */
  defaultSlaHours: number;
  /** Orden por defecto. */
  defaultOrder: 'SECUENCIAL' | 'PARALELO';
  /** Exigir sello de tiempo RFC 3161 en el manifiesto. */
  requireTimestamp: boolean;
  /** Exigir consentimiento versionado antes de firmar. */
  requireConsent: boolean;
  /** Perfil de certificado para la firma DIGITAL (informativo para el custodio). */
  certificateProfile: string;
}

export const DEFAULT_SIGNATURE_POLICY: SignaturePolicy = {
  version: 0,
  source: 'default',
  allowedMethods: ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA', 'ACCEPT', 'PASSKEY'],
  defaultSlaHours: 72,
  defaultOrder: 'SECUENCIAL',
  requireTimestamp: true,
  requireConsent: true,
  certificateProfile: 'prestige-firmantes-v1',
};

export const SIGNATURE_POLICY_KEY = 'signature.policy';

/**
 * M10 — resuelve la política de firma efectiva para un tenant: fusiona lo que
 * haya en `Policy[tenant, 'signature.policy']` sobre `DEFAULT_SIGNATURE_POLICY`,
 * conservando el número de versión de la fila. Valida una solicitud contra ella.
 */
@Injectable()
export class SignaturePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string): Promise<SignaturePolicy> {
    const row = await this.prisma.policy
      .findFirst({ where: { key: SIGNATURE_POLICY_KEY, tenant: { OR: [{ id: tenantId }, { slug: tenantId }] } } })
      .catch(() => null);
    if (!row) return { ...DEFAULT_SIGNATURE_POLICY };

    const v = (row.value ?? {}) as Partial<SignaturePolicy>;
    return {
      version: row.version,
      source: 'tenant',
      allowedMethods:
        Array.isArray(v.allowedMethods) && v.allowedMethods.length
          ? (v.allowedMethods as SignatureMethodName[])
          : DEFAULT_SIGNATURE_POLICY.allowedMethods,
      defaultSlaHours: typeof v.defaultSlaHours === 'number' ? v.defaultSlaHours : DEFAULT_SIGNATURE_POLICY.defaultSlaHours,
      defaultOrder: v.defaultOrder === 'PARALELO' ? 'PARALELO' : DEFAULT_SIGNATURE_POLICY.defaultOrder,
      requireTimestamp: v.requireTimestamp ?? DEFAULT_SIGNATURE_POLICY.requireTimestamp,
      requireConsent: v.requireConsent ?? DEFAULT_SIGNATURE_POLICY.requireConsent,
      certificateProfile:
        typeof v.certificateProfile === 'string' ? v.certificateProfile : DEFAULT_SIGNATURE_POLICY.certificateProfile,
    };
  }

  /** Lanza si la solicitud viola la política; devuelve los valores efectivos. */
  enforce(
    policy: SignaturePolicy,
    req: { methods: SignatureMethodName[]; order?: 'SECUENCIAL' | 'PARALELO'; slaHours?: number },
  ): { order: 'SECUENCIAL' | 'PARALELO'; slaHours: number } {
    const bad = req.methods.filter((m) => !policy.allowedMethods.includes(m));
    if (bad.length) {
      throw new BadRequestException(
        `La política del tenant (v${policy.version}) no permite: ${bad.join(', ')}. ` +
          `Permitidos: ${policy.allowedMethods.join(', ')}`,
      );
    }
    return {
      order: req.order ?? policy.defaultOrder,
      slaHours: req.slaHours ?? policy.defaultSlaHours,
    };
  }
}
