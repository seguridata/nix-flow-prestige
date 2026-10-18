import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import forge from 'node-forge';
import { buildP12, ensureCaChain, issueLeaf, loadCaChain } from './ca';
import type { KeyCustodian, SigningMaterial } from './key-custodian';

const PKI_DIR = () => process.env.PKI_DIR ?? join(process.cwd(), 'pki');
/**
 * Carpeta de los P12 por firmante. Por defecto `PKI_DIR/signers`. En Kubernetes `PKI_DIR` es un Secret de solo
 * lectura, así que los P12 emitidos en runtime van a un volumen escribible compartido (RWX) con `PKI_SIGNERS_DIR`.
 */
const SIGNERS_DIR = () => process.env.PKI_SIGNERS_DIR?.trim() || join(PKI_DIR(), 'signers');

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
 * Sanea un valor para usarlo como UN segmento de ruta: solo `[\w.@-]`, sin
 * `..`, `/` ni `\`. Mismo mapeo base que usaban los P12 antiguos.
 */
function pathSegment(value: string, what: string): string {
  const safe = value.replace(/[^\w.@-]+/g, '_').replace(/\.{2,}/g, '_');
  if (!safe || safe === '.') {
    throw new Error(`${what} inválido para usarlo como ruta de llave`);
  }
  return safe;
}

/** Segmento de los P12 antiguos (sin tenant). Solo para leer datos viejos. */
function legacySegment(signerId: string): string {
  return signerId.replace(/[^\w.@-]+/g, '_');
}

/**
 * Custodio por software: emite y guarda un PKCS#12 por tenant y firmante bajo
 * `PKI_DIR/signers/<tenantId>/<signerId>.p12`, firmado por la CA interna del
 * proyecto. Real, no simulado: produce certificados X.509 válidos y firmas
 * PAdES verificables en Adobe. Se conmuta al HSM cambiando `KEY_CUSTODIAN=pkcs11`.
 *
 * COMPATIBILIDAD / MIGRACIÓN: antes los P12 vivían en
 * `PKI_DIR/signers/<signerId>.p12` (+ `.json`). Si existe el archivo antiguo y
 * NO el nuevo, se lee el antiguo con un `warn` (para no emitir un certificado
 * distinto al mismo firmante de datos viejos). Paso de migración: mover cada
 * `signers/<signerId>.{p12,json}` a `signers/<tenantId>/` del tenant al que
 * pertenece el firmante y borrar el original; tras migrar todos, la lectura
 * heredada deja de usarse.
 */
@Injectable()
export class SoftwareKeyCustodian implements KeyCustodian {
  readonly kind = 'software' as const;
  private readonly log = new Logger(SoftwareKeyCustodian.name);
  private readonly cache = new Map<string, SigningMaterial>();

  async getSigningMaterial(signerId: string, displayName?: string, tenantId?: string): Promise<SigningMaterial> {
    if (!tenantId) {
      throw new Error('SoftwareKeyCustodian requiere tenantId: el P12 del firmante es por tenant');
    }
    const cacheKey = `${tenantId}/${signerId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const dir = PKI_DIR();
    const caDir = join(dir, 'ca');
    if (!existsSync(join(caDir, 'intermediate.cert.pem'))) {
      if (process.env.NODE_ENV === 'production') {
        // Con varias réplicas y disco local cada una crearía una CA distinta.
        throw new ServiceUnavailableException(
          `Falta la CA interna en ${caDir}. En producción no se autogenera: ejecuta \`bun run pki:init\` una vez y comparte PKI_DIR entre réplicas.`,
        );
      }
      ensureCaChain(caDir); // primera vez en dev
    }
    const ca = loadCaChain(caDir);

    const tenantDir = join(SIGNERS_DIR(), pathSegment(tenantId, 'tenantId'));
    mkdirSync(tenantDir, { recursive: true });
    const safe = pathSegment(signerId, 'signerId');
    let p12Path = join(tenantDir, `${safe}.p12`);
    let metaPath = join(tenantDir, `${safe}.json`);

    if (!(existsSync(p12Path) && existsSync(metaPath))) {
      const legacyBase = join(SIGNERS_DIR(), legacySegment(signerId));
      if (existsSync(`${legacyBase}.p12`) && existsSync(`${legacyBase}.json`)) {
        this.log.warn(
          `Usando el P12 heredado signers/${legacySegment(signerId)}.p12 (sin tenant) para ${cacheKey}. Muévelo a signers/<tenantId>/${safe}.p12.`,
        );
        p12Path = `${legacyBase}.p12`;
        metaPath = `${legacyBase}.json`;
      }
    }

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
      this.log.log(`Certificado de firma emitido para ${cacheKey} (serie ${certificate.serialNumber})`);
      material = { p12, passphrase: PASSPHRASE(), certificatePem: leaf.certPem, certificate };
    }

    this.cache.set(cacheKey, material);
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
