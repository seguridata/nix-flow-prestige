import { randomBytes } from 'node:crypto';
import forge from 'node-forge';

/**
 * Cliente RFC 3161 (sello de tiempo) — real, no simulado. Envía un
 * `TimeStampReq` DER a `TSA_URL` y devuelve el `TimeStampToken` (CMS
 * SignedData) tal cual, más su `TSTInfo` decodificado.
 *
 * Por defecto se apunta a una TSA pública real; en producción se cambia
 * `TSA_URL` por la TSA que opera SeguriData como PSC.
 */

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_CT_TST_INFO = '1.2.840.113549.1.9.16.1.4';

export interface TstInfo {
  policy: string;
  hashAlgorithmOid: string;
  hashedMessage: Buffer;
  serialNumber: string;
  genTime: string; // ISO
}

export interface TimestampResult {
  /** CMS SignedData (DER). Se guarda en el manifiesto (base64). */
  token: Buffer;
  info: TstInfo;
  tsaUrl: string;
}

function buildTimeStampReq(hash: Buffer): Buffer {
  const { asn1 } = forge;
  const messageImprint = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, hash.toString('binary')),
  ]);
  const nonce = asn1.create(
    asn1.Class.UNIVERSAL,
    asn1.Type.INTEGER,
    false,
    forge.util.hexToBytes(randomBytes(8).toString('hex')),
  );
  const req = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(1)), // version v1
    messageImprint,
    nonce,
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0xff)), // certReq TRUE
  ]);
  return Buffer.from(asn1.toDer(req).getBytes(), 'binary');
}

/** Navega ContentInfo → SignedData → encapContentInfo.eContent y decodifica TSTInfo. */
export function parseTimestampToken(tokenDer: Buffer): TstInfo {
  const { asn1 } = forge;
  const root = asn1.fromDer(tokenDer.toString('binary'));
  // ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT SignedData }
  const signedData = (root.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[];
  const sd = signedData[0].value as forge.asn1.Asn1[];
  // SignedData: version, digestAlgorithms SET, encapContentInfo SEQUENCE {eContentType OID, eContent [0] OCTET STRING}
  const encap = sd[2].value as forge.asn1.Asn1[];
  const eContentOctet = ((encap[1].value as forge.asn1.Asn1[])[0].value as string);
  const tst = asn1.fromDer(eContentOctet);
  const t = tst.value as forge.asn1.Asn1[];
  // TSTInfo: version, policy OID, messageImprint SEQUENCE, serialNumber INTEGER, genTime GeneralizedTime, ...
  const mi = t[2].value as forge.asn1.Asn1[];
  const hashAlgo = ((mi[0].value as forge.asn1.Asn1[])[0].value as string);
  const hashedMessage = Buffer.from((mi[1].value as string), 'binary');
  const serialBytes = t[3].value as string;
  const genTimeStr = t[4].value as string; // e.g. 20260910T221500Z
  return {
    policy: asn1.derToOid(t[1].value as string),
    hashAlgorithmOid: asn1.derToOid(hashAlgo),
    hashedMessage,
    serialNumber: forge.util.bytesToHex(serialBytes),
    genTime: parseGeneralizedTime(genTimeStr),
  };
}

function parseGeneralizedTime(s: string): string {
  // YYYYMMDDHHMMSS[.fff]Z
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi, se] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`).toISOString();
}

export async function requestTimestamp(hash: Buffer): Promise<TimestampResult | null> {
  const url = process.env.TSA_URL?.trim();
  if (!url) return null;

  const reqDer = buildTimeStampReq(hash);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query' },
    body: new Uint8Array(reqDer),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`TSA ${url} respondió ${res.status}`);
  }
  const respDer = Buffer.from(await res.arrayBuffer());
  const { asn1 } = forge;
  const resp = asn1.fromDer(respDer.toString('binary'));
  // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken ContentInfo OPTIONAL }
  const parts = resp.value as forge.asn1.Asn1[];
  const statusInfo = parts[0].value as forge.asn1.Asn1[];
  const status = (statusInfo[0].value as string).charCodeAt(0);
  if (status !== 0 && status !== 1) {
    throw new Error(`TSA rechazó la solicitud (PKIStatus ${status})`);
  }
  if (parts.length < 2) throw new Error('TSA no devolvió timeStampToken');
  const token = Buffer.from(asn1.toDer(parts[1]).getBytes(), 'binary');
  return { token, info: parseTimestampToken(token), tsaUrl: url };
}

export function verifyTimestampToken(
  tokenDer: Buffer,
  expectedHash: Buffer,
): { valid: boolean; genTime?: string; reason?: string } {
  try {
    const info = parseTimestampToken(tokenDer);
    if (info.hashAlgorithmOid !== OID_SHA256) {
      return { valid: false, reason: `Algoritmo de hash del sello no soportado: ${info.hashAlgorithmOid}` };
    }
    if (!info.hashedMessage.equals(expectedHash)) {
      return { valid: false, reason: 'El hash sellado no coincide con el del paquete' };
    }
    return { valid: true, genTime: info.genTime };
  } catch (error) {
    return { valid: false, reason: (error as Error).message };
  }
}

export { OID_CT_TST_INFO };
