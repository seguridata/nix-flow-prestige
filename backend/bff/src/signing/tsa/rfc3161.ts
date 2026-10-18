import { createHash, randomBytes, verify as cryptoVerify, X509Certificate } from 'node:crypto';
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

// --- Verificación criptográfica CMS SignedData (RFC 5652 / RFC 3161 §2.3) ---
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_MESSAGE_DIGEST_ATTR = '1.2.840.113549.1.9.4';
const OID_CONTENT_TYPE_ATTR = '1.2.840.113549.1.9.3';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_TIMESTAMPING_EKU = '1.3.6.1.5.5.7.3.8';

/** Algoritmos de hash aceptados para el digest del firmante (rechaza MD5/SHA-1). */
const DIGEST_ALG_HASH_NAMES: Record<string, string> = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};

/**
 * OIDs de `digestEncryptionAlgorithm` aceptados. El valor es el hash que la
 * propia OID implica (cuando lo codifica, p.ej. `sha256WithRSAEncryption` o
 * `ecdsa-with-SHA256`), o `''` para las OIDs "desnudas" (p.ej. `rsaEncryption`)
 * donde el hash real se toma del `digestAlgorithm` del SignerInfo. Cualquier
 * OID fuera de esta lista (incluye MD5/SHA-1) se rechaza.
 */
const SIGNATURE_ALG_EMBEDDED_HASH: Record<string, string> = {
  '1.2.840.113549.1.1.1': '', // rsaEncryption
  '1.2.840.113549.1.1.11': 'sha256', // sha256WithRSAEncryption
  '1.2.840.113549.1.1.12': 'sha384', // sha384WithRSAEncryption
  '1.2.840.113549.1.1.13': 'sha512', // sha512WithRSAEncryption
  '1.2.840.10045.4.3.2': 'sha256', // ecdsa-with-SHA256
  '1.2.840.10045.4.3.3': 'sha384', // ecdsa-with-SHA384
  '1.2.840.10045.4.3.4': 'sha512', // ecdsa-with-SHA512
};

/**
 * Los tipos de `@types/node-forge` no cubren `asn1.validate` ni los
 * validadores expuestos por `pkcs7asn1.js` (`forge.pkcs7.asn1.*`), aunque
 * ambos existen en tiempo de ejecución (node-forge 1.4.0). Se declara aquí
 * el mínimo necesario en vez de recurrir a `any` disperso por el archivo.
 */
interface Asn1ValidatorSchema {
  name: string;
  tagClass?: forge.asn1.Class;
  type?: forge.asn1.Type | number;
  constructed?: boolean;
  optional?: boolean;
  capture?: string;
  captureAsn1?: string;
  value?: Asn1ValidatorSchema[];
}
type Asn1Capture = Record<string, unknown>;
const asn1Validate = (
  forge.asn1 as unknown as {
    validate(obj: forge.asn1.Asn1, validator: Asn1ValidatorSchema, capture: Asn1Capture, errors: string[]): boolean;
  }
).validate;
const signedDataValidator = (
  forge.pkcs7 as unknown as { asn1: { signedDataValidator: Asn1ValidatorSchema } }
).asn1.signedDataValidator;

/**
 * Validador ASN.1 mínimo de TBSCertificate: solo lo necesario para ubicar
 * `serialNumber` e `issuer` sin pasar por `forge.pki.certificateFromAsn1`
 * (que revienta con "OID is not RSA" ante certificados ECDSA — comprobado
 * empíricamente contra un token real de freetsa.org, cuya TSA firma con
 * EC P-384/SHA-512).
 */
const tbsCertMiniValidator: Asn1ValidatorSchema = {
  name: 'TBSCertificateMini',
  tagClass: forge.asn1.Class.UNIVERSAL,
  type: forge.asn1.Type.SEQUENCE,
  constructed: true,
  value: [
    {
      name: 'TBSCertificateMini.version',
      tagClass: forge.asn1.Class.CONTEXT_SPECIFIC,
      type: 0,
      constructed: true,
      optional: true,
      captureAsn1: 'certVersion',
    },
    {
      name: 'TBSCertificateMini.serialNumber',
      tagClass: forge.asn1.Class.UNIVERSAL,
      type: forge.asn1.Type.INTEGER,
      constructed: false,
      capture: 'certSerial',
    },
    {
      name: 'TBSCertificateMini.signatureAlgorithm',
      tagClass: forge.asn1.Class.UNIVERSAL,
      type: forge.asn1.Type.SEQUENCE,
      constructed: true,
      captureAsn1: 'certSigAlg',
    },
    {
      name: 'TBSCertificateMini.issuer',
      tagClass: forge.asn1.Class.UNIVERSAL,
      type: forge.asn1.Type.SEQUENCE,
      constructed: true,
      captureAsn1: 'certIssuer',
    },
  ],
};

function normalizeSerialHex(hex: string): string {
  return hex.replace(/^0+/, '') || '0';
}

/** Extrae las extensiones ([3] EXPLICIT) de un TBSCertificate crudo, sin asumir índice fijo. */
function findCertExtensions(tbs: forge.asn1.Asn1): forge.asn1.Asn1[] {
  const children = tbs.value as forge.asn1.Asn1[];
  const extWrap = children.find(
    (f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && f.type === 3,
  );
  if (!extWrap) return [];
  const extSeq = (extWrap.value as forge.asn1.Asn1[])[0];
  return (extSeq?.value as forge.asn1.Asn1[]) ?? [];
}

/** Verifica que el certificado tenga EKU id-kp-timeStamping, crítica y única (RFC 3161 §2.3). */
function hasCriticalTimestampingEku(tbs: forge.asn1.Asn1): boolean {
  const { asn1 } = forge;
  for (const extNode of findCertExtensions(tbs)) {
    const fields = extNode.value as forge.asn1.Asn1[];
    const oid = asn1.derToOid(fields[0].value as string);
    if (oid !== OID_EXT_KEY_USAGE) continue;
    let idx = 1;
    let critical = false;
    if (fields[1] && fields[1].type === asn1.Type.BOOLEAN) {
      critical = (fields[1].value as string).charCodeAt(0) !== 0;
      idx = 2;
    }
    const extnValueOctet = fields[idx];
    try {
      const ekuSeq = asn1.fromDer(extnValueOctet.value as string);
      const purposes = (ekuSeq.value as forge.asn1.Asn1[]).map((n) => asn1.derToOid(n.value as string));
      return critical && purposes.length === 1 && purposes[0] === OID_TIMESTAMPING_EKU;
    } catch {
      return false;
    }
  }
  return false;
}

function findSignerCertificate(
  certsAsn1: forge.asn1.Asn1[],
  wantedSerialHex: string,
  wantedIssuer: forge.asn1.Asn1,
): forge.asn1.Asn1 | null {
  const { asn1 } = forge;
  const wantedIssuerDer = asn1.toDer(wantedIssuer).getBytes();
  for (const certNode of certsAsn1) {
    const tbs = (certNode.value as forge.asn1.Asn1[])[0];
    const certCapture: Record<string, unknown> = {};
    if (!asn1Validate(tbs, tbsCertMiniValidator, certCapture, [])) continue;
    const serialHex = normalizeSerialHex(forge.util.bytesToHex(certCapture.certSerial as string));
    if (serialHex !== wantedSerialHex) continue;
    const issuerDer = asn1.toDer(certCapture.certIssuer as forge.asn1.Asn1).getBytes();
    if (issuerDer !== wantedIssuerDer) continue;
    return certNode;
  }
  return null;
}

export interface SignatureCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verifica la firma criptográfica CMS SignedData del TimeStampToken
 * (RFC 5652 §5.4 / §11): re-construye los bytes firmados (signedAttrs
 * re-etiquetados como SET universal, o el eContent si no hay atributos
 * firmados), localiza el certificado del firmante por issuer+serial, y
 * comprueba la firma con la clave pública del certificado usando Node
 * `crypto.verify` (soporta RSA y ECDSA sin distinción especial).
 *
 * También valida: algoritmos permitidos (rechaza MD5/SHA-1), que el
 * message-digest firmado coincide con el digest real del eContent, que el
 * certificado estaba vigente en `genTime`, y que tiene la EKU
 * id-kp-timeStamping marcada crítica y única (RFC 3161 §2.3).
 */
function verifyCmsSignature(tokenDer: Buffer, genTime: string): SignatureCheckResult {
  const { asn1 } = forge;
  let root: forge.asn1.Asn1;
  try {
    root = asn1.fromDer(tokenDer.toString('binary'));
  } catch (error) {
    return { ok: false, reason: `ASN.1 inválido: ${(error as Error).message}` };
  }

  const rootParts = root.value as forge.asn1.Asn1[];
  const outerContentType = asn1.derToOid(rootParts[0].value as string);
  if (outerContentType !== OID_SIGNED_DATA) {
    return { ok: false, reason: `ContentInfo no es SignedData (OID ${outerContentType})` };
  }
  const sdNode = (rootParts[1].value as forge.asn1.Asn1[])[0];

  // Nota: NO se usa `forge.pkcs7.messageFromAsn1` — su `_fromAsn1` interno
  // rechaza cualquier eContentType distinto de "Data" ("Only wrapped
  // ContentType Data supported"), lo cual excluye siempre a TSTInfo.
  // Comprobado empíricamente: lanza esa excepción contra un token real.
  // Se valida el SignedData directamente con su validador ASN.1.
  const capture: Record<string, unknown> = {};
  const errors: string[] = [];
  if (!asn1Validate(sdNode, signedDataValidator, capture, errors)) {
    return { ok: false, reason: `SignedData inválido: ${errors.join('; ')}` };
  }

  const eContentTypeOid = asn1.derToOid(capture.contentType as string);
  if (eContentTypeOid !== OID_CT_TST_INFO) {
    return { ok: false, reason: `encapContentInfo no es TSTInfo (OID ${eContentTypeOid})` };
  }
  const contentWrap = capture.content as forge.asn1.Asn1 | undefined;
  const eContentBytes = contentWrap ? ((contentWrap.value as forge.asn1.Asn1[])[0]?.value as string) : undefined;
  if (typeof eContentBytes !== 'string') {
    return { ok: false, reason: 'El TimeStampToken no contiene eContent' };
  }

  const signerInfos = capture.signerInfos as forge.asn1.Asn1[] | undefined;
  if (!signerInfos || signerInfos.length !== 1) {
    return { ok: false, reason: `Se esperaba exactamente 1 SignerInfo, hay ${signerInfos?.length ?? 0}` };
  }

  const digestAlgOid = asn1.derToOid(capture.digestAlgorithm as string);
  const digestHashName = DIGEST_ALG_HASH_NAMES[digestAlgOid];
  if (!digestHashName) {
    return { ok: false, reason: `Algoritmo de digest del firmante no soportado: ${digestAlgOid}` };
  }

  const sigAlgNodes = capture.signatureAlgorithm as forge.asn1.Asn1[];
  const sigAlgOid = asn1.derToOid(sigAlgNodes[0].value as string);
  if (!(sigAlgOid in SIGNATURE_ALG_EMBEDDED_HASH)) {
    return { ok: false, reason: `Algoritmo de firma no soportado: ${sigAlgOid}` };
  }
  const embeddedHash = SIGNATURE_ALG_EMBEDDED_HASH[sigAlgOid];
  if (embeddedHash && embeddedHash !== digestHashName) {
    return {
      ok: false,
      reason: `El algoritmo de firma (${sigAlgOid}) no coincide con el digestAlgorithm declarado`,
    };
  }

  const signatureBytes = Buffer.from(capture.signature as string, 'binary');

  const authAttrsNodes = capture.authenticatedAttributes as forge.asn1.Asn1[] | undefined;
  let dataToVerify: Buffer;
  if (authAttrsNodes && authAttrsNodes.length > 0) {
    let messageDigestBytes: string | undefined;
    let contentTypeAttrOid: string | undefined;
    for (const attrNode of authAttrsNodes) {
      const attrFields = attrNode.value as forge.asn1.Asn1[];
      const attrOid = asn1.derToOid(attrFields[0].value as string);
      const attrValues = attrFields[1].value as forge.asn1.Asn1[];
      if (attrOid === OID_MESSAGE_DIGEST_ATTR) {
        messageDigestBytes = attrValues[0]?.value as string;
      } else if (attrOid === OID_CONTENT_TYPE_ATTR) {
        contentTypeAttrOid = asn1.derToOid(attrValues[0]?.value as string);
      }
    }
    if (!messageDigestBytes) {
      return { ok: false, reason: 'signedAttrs no incluye message-digest' };
    }
    if (contentTypeAttrOid && contentTypeAttrOid !== eContentTypeOid) {
      return { ok: false, reason: 'signedAttrs.content-type no coincide con eContentType' };
    }
    const actualDigest = createHash(digestHashName).update(Buffer.from(eContentBytes, 'binary')).digest();
    if (!actualDigest.equals(Buffer.from(messageDigestBytes, 'binary'))) {
      return { ok: false, reason: 'message-digest firmado no coincide con el digest real del eContent' };
    }
    // RFC 5652 §5.4: para computar/verificar la firma, el SET [0] IMPLICIT
    // de signedAttrs se re-etiqueta como SET universal (0x31); los bytes de
    // contenido no cambian. Como forge ya capturó los hijos como nodos
    // ASN.1 (no como bytes crudos), basta con re-envolverlos.
    const retaggedSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, authAttrsNodes);
    dataToVerify = Buffer.from(asn1.toDer(retaggedSet).getBytes(), 'binary');
  } else {
    dataToVerify = Buffer.from(eContentBytes, 'binary');
  }

  const certsWrap = capture.certificates as forge.asn1.Asn1 | undefined;
  const certsAsn1 = (certsWrap?.value as forge.asn1.Asn1[]) ?? [];
  if (certsAsn1.length === 0) {
    return { ok: false, reason: 'El token no incluye certificados; no se puede verificar la firma' };
  }
  const wantedSerialHex = normalizeSerialHex(forge.util.bytesToHex(capture.serial as string));
  const issuerNode = capture.issuer as forge.asn1.Asn1;
  const certNode = findSignerCertificate(certsAsn1, wantedSerialHex, issuerNode);
  if (!certNode) {
    return { ok: false, reason: 'No se encontró en el token el certificado del firmante (issuer+serial)' };
  }
  const tbs = (certNode.value as forge.asn1.Asn1[])[0];

  if (!hasCriticalTimestampingEku(tbs)) {
    return {
      ok: false,
      reason: 'El certificado del firmante no tiene la EKU id-kp-timeStamping crítica y exclusiva (RFC 3161 §2.3)',
    };
  }

  let x509: X509Certificate;
  try {
    const certDer = Buffer.from(asn1.toDer(certNode).getBytes(), 'binary');
    x509 = new X509Certificate(certDer);
  } catch (error) {
    return { ok: false, reason: `No se pudo leer el certificado del firmante: ${(error as Error).message}` };
  }

  const genTimeMs = Date.parse(genTime);
  const notBeforeMs = Date.parse(x509.validFrom);
  const notAfterMs = Date.parse(x509.validTo);
  if (!Number.isNaN(genTimeMs) && (genTimeMs < notBeforeMs || genTimeMs > notAfterMs)) {
    return { ok: false, reason: 'El certificado del firmante no estaba vigente en genTime' };
  }

  let sigOk: boolean;
  try {
    sigOk = cryptoVerify(digestHashName, dataToVerify, x509.publicKey, signatureBytes);
  } catch (error) {
    return { ok: false, reason: `Fallo al verificar la firma: ${(error as Error).message}` };
  }
  if (!sigOk) {
    return { ok: false, reason: 'La firma CMS del TimeStampToken no es válida' };
  }

  return { ok: true };
}

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

export interface TimestampVerificationResult {
  valid: boolean;
  genTime?: string;
  reason?: string;
  /**
   * `true` cuando la firma CMS SignedData del token fue verificada
   * criptográficamente contra el certificado del firmante embebido
   * (RFC 5652 §5.4/§11), más allá del simple cotejo de `hashedMessage`.
   */
  signatureVerified?: boolean;
  /**
   * `true` solo si, además de la firma, se validó la cadena hasta una CA
   * raíz de confianza configurada para esta TSA. Este repositorio no trae
   * empaquetada ninguna raíz de terceros (freetsa.org u otra), así que hoy
   * este campo es siempre `false` cuando `valid` es `true` — es un hueco de
   * infraestructura conocido, no de lógica de verificación, y debe
   * resolverse con una lista de confianza explícita en un follow-up.
   */
  trustedChain?: boolean;
}

export function verifyTimestampToken(
  tokenDer: Buffer,
  expectedHash: Buffer,
): TimestampVerificationResult {
  try {
    const info = parseTimestampToken(tokenDer);
    if (info.hashAlgorithmOid !== OID_SHA256) {
      return { valid: false, reason: `Algoritmo de hash del sello no soportado: ${info.hashAlgorithmOid}` };
    }
    if (!info.hashedMessage.equals(expectedHash)) {
      return { valid: false, reason: 'El hash sellado no coincide con el del paquete' };
    }
    const sig = verifyCmsSignature(tokenDer, info.genTime);
    if (!sig.ok) {
      return { valid: false, genTime: info.genTime, signatureVerified: false, reason: sig.reason };
    }
    return { valid: true, genTime: info.genTime, signatureVerified: true, trustedChain: false };
  } catch (error) {
    return { valid: false, reason: (error as Error).message };
  }
}

export { OID_CT_TST_INFO };
