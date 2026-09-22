import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Firma Ed25519 del manifiesto de evidencia (M11). Hace el manifiesto
 * append-only y verificable **offline**: quien tenga la clave pública puede
 * comprobar que el JSON canónico no se alteró, sin BFF ni base de datos.
 */
@Injectable()
export class ManifestSigner {
  private readonly log = new Logger(ManifestSigner.name);
  private priv?: ReturnType<typeof createPrivateKey>;
  private pubPem?: string;
  readonly keyId: string | null;

  constructor() {
    const dir = process.env.PKI_DIR
      ? join(process.cwd(), process.env.PKI_DIR.replace(/^\.\//, ''))
      : join(process.cwd(), 'pki');
    const keyPath = join(dir, 'manifest-signing.key.pem');
    const pubPath = join(dir, 'manifest-signing.pub.pem');
    if (existsSync(keyPath) && existsSync(pubPath)) {
      this.priv = createPrivateKey(readFileSync(keyPath));
      this.pubPem = readFileSync(pubPath, 'utf8');
      this.keyId = ManifestSigner.keyIdFrom(this.pubPem);
    } else {
      this.keyId = null;
      this.log.warn('Falta la llave de firma del manifiesto (ejecuta `bun run pki:init`). Se guardará sin firmar.');
    }
  }

  static keyIdFrom(pubPem: string): string {
    const der = createPublicKey(pubPem).export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 32);
  }

  /** JSON canónico determinista (claves ordenadas recursivamente). */
  static canonical(value: unknown): string {
    return JSON.stringify(sortDeep(value));
  }

  hash(manifest: unknown): string {
    return createHash('sha256').update(ManifestSigner.canonical(manifest)).digest('hex');
  }

  sign(manifest: unknown): { manifestHash: string; signature: string | null; keyId: string | null; publicKeyPem: string | null } {
    const manifestHash = this.hash(manifest);
    if (!this.priv) return { manifestHash, signature: null, keyId: null, publicKeyPem: null };
    const signature = edSign(null, Buffer.from(ManifestSigner.canonical(manifest)), this.priv).toString('base64');
    return { manifestHash, signature, keyId: this.keyId, publicKeyPem: this.pubPem ?? null };
  }

  verify(manifest: unknown, signatureB64: string, publicKeyPem?: string): boolean {
    const pem = publicKeyPem ?? this.pubPem;
    if (!pem) return false;
    return edVerify(
      null,
      Buffer.from(ManifestSigner.canonical(manifest)),
      createPublicKey(pem),
      Buffer.from(signatureB64, 'base64'),
    );
  }

  get publicKeyPem(): string | null {
    return this.pubPem ?? null;
  }
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}
