import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

/**
 * Autenticador WebAuthn por software, solo para pruebas: ES256 (P-256) con
 * attestation 'none'. Produce respuestas JSON con el mismo formato que envía
 * el navegador, para que @simplewebauthn/server las verifique de verdad.
 */

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

// --- CBOR mínimo (enteros, bytes, texto, mapas) ---
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}
const cInt = (n: number) => (n >= 0 ? head(0, n) : head(1, -1 - n));
const cBytes = (b: Uint8Array) => Buffer.concat([head(2, b.length), Buffer.from(b)]);
const cText = (s: string) => Buffer.concat([head(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cMap = (entries: Array<[Buffer, Buffer]>) =>
  Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [k, v])]);

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_AT = 0x40;

export interface AssertOptions {
  challenge: string;
  origin: string;
  rpID: string;
  signCount: number;
  flags?: number;
  /** Tipo en clientDataJSON (por defecto webauthn.get). */
  type?: string;
}

export class TestAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicKeyCose: Buffer;

  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x!, 'base64url');
    const y = Buffer.from(jwk.y!, 'base64url');
    this.publicKeyCose = cMap([
      [cInt(1), cInt(2)], // kty EC2
      [cInt(3), cInt(-7)], // alg ES256
      [cInt(-1), cInt(1)], // crv P-256
      [cInt(-2), cBytes(x)],
      [cInt(-3), cBytes(y)],
    ]);
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private authData(rpID: string, flags: number, signCount: number, withCredential: boolean): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(signCount);
    const parts: Uint8Array[] = [sha256(rpID), Buffer.from([flags]), counter];
    if (withCredential) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, this.publicKeyCose);
    }
    return Buffer.concat(parts);
  }

  register(o: { challenge: string; origin: string; rpID: string; signCount?: number; flags?: number }) {
    const authData = this.authData(
      o.rpID,
      o.flags ?? FLAG_UP | FLAG_UV | FLAG_AT,
      o.signCount ?? 0,
      true,
    );
    const attestationObject = cMap([
      [cText('fmt'), cText('none')],
      [cText('attStmt'), cMap([])],
      [cText('authData'), cBytes(authData)],
    ]);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(this.clientData('webauthn.create', o.challenge, o.origin)),
        attestationObject: b64u(attestationObject),
        transports: ['internal' as const],
      },
      clientExtensionResults: {},
    };
  }

  assert(o: AssertOptions) {
    const authData = this.authData(o.rpID, o.flags ?? FLAG_UP | FLAG_UV, o.signCount, false);
    const clientDataJSON = this.clientData(o.type ?? 'webauthn.get', o.challenge, o.origin);
    const signature = createSign('sha256')
      .update(Buffer.concat([authData, sha256(clientDataJSON)]))
      .sign(this.privateKey); // DER, como WebAuthn
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
      clientExtensionResults: {},
    };
  }
}
