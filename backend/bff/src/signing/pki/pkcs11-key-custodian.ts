import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import forge from 'node-forge';
import type { KeyCustodian, SigningMaterial } from './key-custodian';
import { readPkcs11Config, redactSecret, type Pkcs11Config } from './pkcs11-config';
import { openGrapheneHandle, type Pkcs11SigningHandle } from './pkcs11-graphene';

export type OpenPkcs11 = (config: Pkcs11Config) => Pkcs11SigningHandle;

/**
 * Custodio PKCS#11. La firma ocurre en el token. `getSigningMaterial` no
 * devuelve PKCS#12 ni frase de paso.
 *
 * Este proceso no trae un HSM. Sin módulo, PIN, slot y etiqueta, responde
 * que el servicio no está disponible y no firma con la CA de software.
 */
@Injectable()
export class Pkcs11KeyCustodian implements KeyCustodian {
  readonly kind = 'pkcs11' as const;
  private cached: SigningMaterial | undefined;
  /** Sustituible en tests. Nest lo construye sin argumentos. */
  opener: OpenPkcs11 = openGrapheneHandle;

  async getSigningMaterial(_signerId: string, _displayName?: string): Promise<SigningMaterial> {
    if (this.cached) return this.cached;
    const config = readPkcs11Config(process.env);
    let handle: Pkcs11SigningHandle;
    try {
      handle = this.opener(config);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(
        `No se pudo abrir el HSM. ${redactSecret(message, config.pin)}`,
      );
    }
    const certificate = describePem(handle.certificatePem);
    this.cached = {
      certificatePem: handle.certificatePem,
      certificate,
      chainPem: handle.chainPem,
      signRsaPkcs1: (digestInfo) => handle.signRsaPkcs1(digestInfo),
    };
    return this.cached;
  }
}

function describePem(pem: string): SigningMaterial['certificate'] {
  const cert = forge.pki.certificateFromPem(pem);
  const name = (distinguished: forge.pki.Certificate['subject']) =>
    distinguished.attributes.map((attribute) => `${attribute.shortName ?? attribute.name}=${attribute.value}`).join(', ');
  return {
    serialNumber: cert.serialNumber,
    subject: name(cert.subject),
    issuer: name(cert.issuer),
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
  };
}
