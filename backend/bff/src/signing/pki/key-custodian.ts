/**
 * Puerto de custodia de llaves (Fase B / M09). Aísla al dominio de firma de
 * DÓNDE viven las llaves privadas: hoy en un almacén de software (PKCS#12
 * cifrado emitido por la CA interna del proyecto), mañana en el HSM/PKI de
 * SeguriData vía PKCS#11 — se cambia el adaptador, no el orquestador.
 *
 * Regla del proyecto: la llave privada NUNCA entra al modelo de datos ni a
 * este proceso más allá de la operación de firma.
 */
export interface SigningMaterial {
  /**
   * PKCS#12 del custodio de software. El custodio PKCS#11 no lo llena:
   * la llave privada no sale del token.
   */
  p12?: Buffer;
  /** Frase de paso del PKCS#12. Solo el custodio de software. */
  passphrase?: string;
  /**
   * Firma CKM_RSA_PKCS de un DigestInfo ya armado. La usa el custodio
   * PKCS#11. No hashes otra vez: el DigestInfo ya trae el SHA-256.
   */
  signRsaPkcs1?: (digestInfo: Buffer) => Buffer;
  /** Intermedias, sin la hoja. La hoja va en `certificatePem`. */
  chainPem?: string[];
  /** Certificado hoja en PEM (para registrar en la evidencia; es público). */
  certificatePem: string;
  certificate: {
    serialNumber: string;
    subject: string;
    issuer: string;
    notBefore: string;
    notAfter: string;
  };
}

export interface KeyCustodian {
  readonly kind: 'software' | 'pkcs11';
  /**
   * Devuelve el material de firma del firmante, emitiéndolo si aún no existe.
   * `displayName` es el nombre humano que va al CN del certificado.
   */
  getSigningMaterial(signerId: string, displayName?: string): Promise<SigningMaterial>;
}

export const KEY_CUSTODIAN = Symbol('KEY_CUSTODIAN');
