import { createRequire } from 'node:module';
import { ServiceUnavailableException } from '@nestjs/common';
import { redactSecret, type Pkcs11Config } from './pkcs11-config';

export interface Pkcs11SigningHandle {
  certificatePem: string;
  chainPem: string[];
  /** CKM_RSA_PKCS sobre el DigestInfo. No lee la llave. */
  signRsaPkcs1(digestInfo: Buffer): Buffer;
}

interface GrapheneObject {
  id?: Buffer;
  label?: string;
  value?: Buffer;
  toType?: () => GrapheneObject;
}

interface GrapheneCollection {
  length: number;
  items(index: number): GrapheneObject;
}

interface GrapheneSession {
  login(pin: string): void;
  find(template: Record<string, unknown>): GrapheneCollection | GrapheneObject[];
  createSign(algorithm: string, key: unknown): {
    update(data: Buffer): void;
    final(): Buffer | Uint8Array;
    once?: (data: Buffer) => Buffer | Uint8Array;
  };
}

export interface GrapheneLike {
  Module: {
    load(modulePath: string, name?: string): {
      initialize(): void;
      getSlots(index: number): { flags: number; open(): GrapheneSession } | null;
      finalize(): void;
    };
  };
  SlotFlag: { TOKEN_PRESENT: number };
  ObjectClass: { PRIVATE_KEY: number; CERTIFICATE: number };
  CertificateType: { X_509: number };
}

const require = createRequire(__filename);

function loadGraphene(): GrapheneLike {
  try {
    const name = 'graphene-pk11';
    return require(name) as GrapheneLike;
  } catch {
    throw new ServiceUnavailableException(
      'KEY_CUSTODIAN=pkcs11 pero falta el paquete graphene-pk11. No se exporta la llave: sin módulo PKCS#11 no hay firma. El custodio de este entorno sigue siendo software.',
    );
  }
}

function collectionItems(found: GrapheneCollection | GrapheneObject[]): GrapheneObject[] {
  if (Array.isArray(found)) return found;
  const items: GrapheneObject[] = [];
  for (let i = 0; i < found.length; i += 1) items.push(found.items(i));
  return items;
}

function sameId(a?: Buffer, b?: Buffer): boolean {
  return !!a && !!b && a.length === b.length && a.equals(b);
}

function derToPem(der: Buffer): string {
  const body = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

/**
 * Abre el módulo, inicia sesión y deja un firmador que solo llama a
 * C_Sign. No pide CKA_VALUE de la llave privada.
 */
export function bindGraphene(graphene: GrapheneLike, config: Pkcs11Config): Pkcs11SigningHandle {
  const mod = graphene.Module.load(config.modulePath, 'Prestige');
  try {
    try {
      mod.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('CKR_CRYPTOKI_ALREADY_INITIALIZED')) throw error;
    }
    const slot = mod.getSlots(config.slot);
    if (!slot || (slot.flags & graphene.SlotFlag.TOKEN_PRESENT) === 0) {
      throw new ServiceUnavailableException(`El slot ${config.slot} no tiene token.`);
    }
    const session = slot.open();
    session.login(config.pin);

    const keys = collectionItems(
      session.find({
        class: graphene.ObjectClass.PRIVATE_KEY,
        label: config.keyLabel,
      }),
    );
    if (keys.length === 0) {
      throw new ServiceUnavailableException('No hay una llave privada con la etiqueta configurada.');
    }
    if (keys.length > 1) {
      throw new ServiceUnavailableException('Hay más de una llave privada con esa etiqueta.');
    }
    const privateKey = keys[0].toType ? keys[0].toType() : keys[0];

    const certificates = collectionItems(
      session.find({
        class: graphene.ObjectClass.CERTIFICATE,
        certType: graphene.CertificateType.X_509,
      }),
    );
    const labeled = certificates.filter((cert) => cert.label === config.keyLabel);
    const leafObject = labeled[0] ?? certificates.find((cert) => sameId(cert.id, privateKey.id));
    if (!leafObject?.value) {
      throw new ServiceUnavailableException('El token no tiene el certificado de esa llave.');
    }
    const chain = certificates.filter(
      (cert) => cert !== leafObject && sameId(cert.id, privateKey.id) && cert.value,
    );

    return {
      certificatePem: derToPem(Buffer.from(leafObject.value)),
      chainPem: chain.map((cert) => derToPem(Buffer.from(cert.value!))),
      signRsaPkcs1(digestInfo: Buffer): Buffer {
        // RSA_PKCS firma los bytes que se le dan. El DigestInfo ya trae el hash.
        const op = session.createSign('RSA_PKCS', privateKey);
        if (op.once) return Buffer.from(op.once(digestInfo));
        op.update(digestInfo);
        return Buffer.from(op.final());
      },
    };
  } catch (error) {
    try {
      mod.finalize();
    } catch {
      // El módulo puede quedar inicializado por otro proceso del mismo binario.
    }
    if (error instanceof ServiceUnavailableException) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ServiceUnavailableException(
      `No se pudo usar el módulo PKCS#11. ${redactSecret(message, config.pin)}`,
    );
  }
}

export function openGrapheneHandle(config: Pkcs11Config): Pkcs11SigningHandle {
  return bindGraphene(loadGraphene(), config);
}
