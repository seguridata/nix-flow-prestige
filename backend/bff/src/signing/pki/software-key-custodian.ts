import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import forge from 'node-forge';
import { buildP12, ensureCaChain, issueLeaf, loadCaChain } from './ca';
import type { KeyCustodian, SigningMaterial } from './key-custodian';

const PKI_DIR = () => process.env.PKI_DIR ?? join(process.cwd(), 'pki');

function PASSPHRASE(): string {
  const value = process.env.PKI_PASSPHRASE?.trim() ?? '';
  if (!value || /^REPLACE_ME/i.test(value)) {
    throw new ServiceUnavailableException(
      'PKI_PASSPHRASE no configurada. No hay valor de ejemplo implícito: defínela en el entorno.',
    );
  }
  if (value === 'prestige-pki-dev' && process.env.NODE_ENV === 'production') {
    throw new ServiceUnavailableException(
      'PKI_PASSPHRASE=prestige-pki-dev no es válida en producción.',
    );
  }
  return value;
}

/**
 * Custodio por software: emite y guarda un PKCS#12 por firmante bajo
 * `PKI_DIR/signers/<id>.p12`, firmado por la CA interna del proyecto. Real,
 * no simulado: produce certificados X.509 válidos y firmas PAdES verificables
 * en Adobe. Se conmuta al HSM cambiando `KEY_CUSTODIAN=pkcs11`.
 */
@Injectable()
export class SoftwareKeyCustodian implements KeyCustodian {
  readonly kind = 'software' as const;
  private readonly log = new Logger(SoftwareKeyCustodian.name);
  private readonly cache = new Map<string, SigningMaterial>();

  async getSigningMaterial(signerId: string, displayName?: string): Promise<SigningMaterial> {
    const cached = this.cache.get(signerId);
    if (cached) return cached;

    const dir = PKI_DIR();
    const caDir = join(dir, 'ca');
    if (!existsSync(join(caDir, 'intermediate.cert.pem'))) {
      ensureCaChain(caDir); // primera vez en dev; en prod lo hace `bun run pki:init`
    }
    const ca = loadCaChain(caDir);

    const signersDir = join(dir, 'signers');
    mkdirSync(signersDir, { recursive: true });
    const safe = signerId.replace(/[^\w.@-]+/g, '_');
    const p12Path = join(signersDir, `${safe}.p12`);
    const metaPath = join(signersDir, `${safe}.json`);

    let material: SigningMaterial;
    if (existsSync(p12Path) && existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      material = {
        p12: readFileSync(p12Path),
        passphrase: PASSPHRASE(),
        certificatePem: meta.certificatePem,
        certificate: meta.certificate,
      };
    } else {
      const leaf = issueLeaf(ca, {
        signerId,
        commonName: displayName?.trim() || `Firmante ${signerId}`,
        email: signerId.includes('@') ? signerId : undefined,
      });
      const p12 = buildP12(leaf, ca, PASSPHRASE());
      const certificate = describeCert(leaf.cert);
      writeFileSync(p12Path, p12, { mode: 0o600 });
      writeFileSync(metaPath, JSON.stringify({ certificatePem: leaf.certPem, certificate }, null, 2));
      this.log.log(`Certificado de firma emitido para ${signerId} (serie ${certificate.serialNumber})`);
      material = { p12, passphrase: PASSPHRASE(), certificatePem: leaf.certPem, certificate };
    }

    this.cache.set(signerId, material);
    return material;
  }
}

function describeCert(cert: forge.pki.Certificate) {
  const name = (o: forge.pki.Certificate['subject']) =>
    o.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', ');
  return {
    serialNumber: cert.serialNumber,
    subject: name(cert.subject),
    issuer: name(cert.issuer),
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
  };
}

/** Placeholder real del custodio PKCS#11 (HSM de SeguriData). */
@Injectable()
export class Pkcs11KeyCustodian implements KeyCustodian {
  readonly kind = 'pkcs11' as const;

  async getSigningMaterial(_signerId: string, _displayName?: string): Promise<SigningMaterial> {
    throw new ServiceUnavailableException(
      'KEY_CUSTODIAN=pkcs11 pero falta la integración con el HSM. Configura PKCS11_MODULE / PKCS11_SLOT / PKCS11_PIN ' +
        'y conecta graphene-pk11, o usa KEY_CUSTODIAN=software.',
    );
  }
}
