#!/usr/bin/env node
/**
 * Verificador OFFLINE del expediente probatorio de Prestige (M11).
 *
 *   node verify.mjs <carpeta-o-zip-del-expediente>
 *
 * NO necesita el BFF, la base de datos ni Temporal. Comprueba, de forma
 * independiente:
 *   1. manifestHash        = SHA-256 del cuerpo canónico del manifiesto
 *   2. firma Ed25519 del manifiesto con la clave pública incluida
 *   3. cadena de custodia SHA-256 (génesis = originalHash)
 *   4. signedHash / packageHash recomputados
 *   5. firma PAdES/PKCS#7 embebida en el PDF (estructura + cadena a la CA)
 *   6. sello de tiempo RFC 3161 sobre packageHash (si está presente)
 *
 * El expediente es una carpeta (o zip descomprimido) con:
 *   manifiesto.json           cuerpo + firma + keyId
 *   documento-firmado.pdf      PDF con la firma PAdES
 *   manifiesto.pub.pem         clave pública Ed25519 del manifiesto
 *   tsa-token.tsr              (opcional) token RFC 3161 DER
 *   ca/root.cert.pem, ca/intermediate.cert.pem   (opcional) para validar la cadena del firmante
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createPublicKey, verify as edVerify, verify as cryptoVerify, X509Certificate } from 'node:crypto';
import forge from 'node-forge';

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_CT_TST_INFO = '1.2.840.113549.1.9.16.1.4';
const OID_MESSAGE_DIGEST_ATTR = '1.2.840.113549.1.9.4';
const OID_CONTENT_TYPE_ATTR = '1.2.840.113549.1.9.3';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_TIMESTAMPING_EKU = '1.3.6.1.5.5.7.3.8';

const DIGEST_ALG_HASH_NAMES = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};

// OID de digestEncryptionAlgorithm -> hash que codifica ('' si va "desnudo",
// p.ej. rsaEncryption, y el hash real sale del digestAlgorithm del SignerInfo).
const SIGNATURE_ALG_EMBEDDED_HASH = {
  '1.2.840.113549.1.1.1': '', // rsaEncryption
  '1.2.840.113549.1.1.11': 'sha256', // sha256WithRSAEncryption
  '1.2.840.113549.1.1.12': 'sha384', // sha384WithRSAEncryption
  '1.2.840.113549.1.1.13': 'sha512', // sha512WithRSAEncryption
  '1.2.840.10045.4.3.2': 'sha256', // ecdsa-with-SHA256
  '1.2.840.10045.4.3.3': 'sha384', // ecdsa-with-SHA384
  '1.2.840.10045.4.3.4': 'sha512', // ecdsa-with-SHA512
};

// Validador ASN.1 mínimo de TBSCertificate (solo serialNumber + issuer), para
// no depender de forge.pki.certificateFromAsn1 — que revienta con "OID is
// not RSA" ante certificados ECDSA (confirmado con un token real de
// freetsa.org, cuya TSA firma con EC P-384/SHA-512).
const tbsCertMiniValidator = {
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

function normalizeSerialHex(hex) {
  return hex.replace(/^0+/, '') || '0';
}

function findCertExtensions(tbs) {
  const extWrap = tbs.value.find((f) => f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && f.type === 3);
  if (!extWrap) return [];
  const extSeq = extWrap.value[0];
  return extSeq?.value ?? [];
}

function hasCriticalTimestampingEku(tbs) {
  const { asn1 } = forge;
  for (const extNode of findCertExtensions(tbs)) {
    const fields = extNode.value;
    const oid = asn1.derToOid(fields[0].value);
    if (oid !== OID_EXT_KEY_USAGE) continue;
    let idx = 1;
    let critical = false;
    if (fields[1] && fields[1].type === asn1.Type.BOOLEAN) {
      critical = fields[1].value.charCodeAt(0) !== 0;
      idx = 2;
    }
    try {
      const ekuSeq = asn1.fromDer(fields[idx].value);
      const purposes = ekuSeq.value.map((n) => asn1.derToOid(n.value));
      return critical && purposes.length === 1 && purposes[0] === OID_TIMESTAMPING_EKU;
    } catch {
      return false;
    }
  }
  return false;
}

function findSignerCertificate(certsAsn1, wantedSerialHex, wantedIssuerNode) {
  const { asn1 } = forge;
  const wantedIssuerDer = asn1.toDer(wantedIssuerNode).getBytes();
  for (const certNode of certsAsn1) {
    const tbs = certNode.value[0];
    const certCapture = {};
    if (!asn1.validate(tbs, tbsCertMiniValidator, certCapture, [])) continue;
    const serialHex = normalizeSerialHex(forge.util.bytesToHex(certCapture.certSerial));
    if (serialHex !== wantedSerialHex) continue;
    const issuerDer = asn1.toDer(certCapture.certIssuer).getBytes();
    if (issuerDer !== wantedIssuerDer) continue;
    return certNode;
  }
  return null;
}

/**
 * Verifica la firma criptográfica CMS SignedData de un TimeStampToken RFC
 * 3161 (RFC 5652 §5.4/§11), no solo el messageImprint. Devuelve
 * { ok, reason?, genTime? }. NO se usa forge.pkcs7.messageFromAsn1: su
 * `_fromAsn1` interno rechaza cualquier eContentType distinto de "Data"
 * ("Only wrapped ContentType Data supported"), lo cual excluye siempre a
 * TSTInfo — comprobado empíricamente. Se valida el SignedData directamente.
 */
function verifyRfc3161Signature(tokenDer, expectedPackageHashHex) {
  const { asn1 } = forge;
  const root = asn1.fromDer(tokenDer.toString('binary'));
  const rootParts = root.value;
  const outerContentType = asn1.derToOid(rootParts[0].value);
  if (outerContentType !== OID_SIGNED_DATA) {
    return { ok: false, reason: `ContentInfo no es SignedData (OID ${outerContentType})` };
  }
  const sdNode = rootParts[1].value[0];

  const capture = {};
  const errors = [];
  const signedDataValidator = forge.pkcs7.asn1.signedDataValidator;
  if (!asn1.validate(sdNode, signedDataValidator, capture, errors)) {
    return { ok: false, reason: `SignedData inválido: ${errors.join('; ')}` };
  }

  const eContentTypeOid = asn1.derToOid(capture.contentType);
  if (eContentTypeOid !== OID_CT_TST_INFO) {
    return { ok: false, reason: `encapContentInfo no es TSTInfo (OID ${eContentTypeOid})` };
  }
  const eContentBytes = capture.content?.value?.[0]?.value;
  if (typeof eContentBytes !== 'string') {
    return { ok: false, reason: 'El TimeStampToken no contiene eContent' };
  }

  // TSTInfo: version, policy OID, messageImprint SEQUENCE, serialNumber INTEGER, genTime GeneralizedTime, ...
  const tst = asn1.fromDer(eContentBytes);
  const genTimeRaw = tst.value[4].value;
  const genTimeMatch = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(genTimeRaw);
  const genTime = genTimeMatch
    ? new Date(`${genTimeMatch[1]}-${genTimeMatch[2]}-${genTimeMatch[3]}T${genTimeMatch[4]}:${genTimeMatch[5]}:${genTimeMatch[6]}Z`).toISOString()
    : undefined;

  const signerInfos = capture.signerInfos;
  if (!signerInfos || signerInfos.length !== 1) {
    return { ok: false, reason: `Se esperaba exactamente 1 SignerInfo, hay ${signerInfos?.length ?? 0}` };
  }

  const digestAlgOid = asn1.derToOid(capture.digestAlgorithm);
  const digestHashName = DIGEST_ALG_HASH_NAMES[digestAlgOid];
  if (!digestHashName) {
    return { ok: false, reason: `Algoritmo de digest del firmante no soportado: ${digestAlgOid}` };
  }

  const sigAlgOid = asn1.derToOid(capture.signatureAlgorithm[0].value);
  if (!(sigAlgOid in SIGNATURE_ALG_EMBEDDED_HASH)) {
    return { ok: false, reason: `Algoritmo de firma no soportado: ${sigAlgOid}` };
  }
  const embeddedHash = SIGNATURE_ALG_EMBEDDED_HASH[sigAlgOid];
  if (embeddedHash && embeddedHash !== digestHashName) {
    return { ok: false, reason: `El algoritmo de firma (${sigAlgOid}) no coincide con el digestAlgorithm declarado` };
  }

  const signatureBytes = Buffer.from(capture.signature, 'binary');

  const authAttrsNodes = capture.authenticatedAttributes;
  let dataToVerify;
  if (authAttrsNodes && authAttrsNodes.length > 0) {
    let messageDigestBytes;
    let contentTypeAttrOid;
    for (const attrNode of authAttrsNodes) {
      const attrFields = attrNode.value;
      const attrOid = asn1.derToOid(attrFields[0].value);
      const attrValues = attrFields[1].value;
      if (attrOid === OID_MESSAGE_DIGEST_ATTR) messageDigestBytes = attrValues[0]?.value;
      else if (attrOid === OID_CONTENT_TYPE_ATTR) contentTypeAttrOid = asn1.derToOid(attrValues[0]?.value);
    }
    if (!messageDigestBytes) return { ok: false, reason: 'signedAttrs no incluye message-digest' };
    if (contentTypeAttrOid && contentTypeAttrOid !== eContentTypeOid) {
      return { ok: false, reason: 'signedAttrs.content-type no coincide con eContentType' };
    }
    const actualDigest = createHash(digestHashName).update(Buffer.from(eContentBytes, 'binary')).digest();
    if (!actualDigest.equals(Buffer.from(messageDigestBytes, 'binary'))) {
      return { ok: false, reason: 'message-digest firmado no coincide con el digest real del eContent' };
    }
    // RFC 5652 §5.4: para verificar la firma, el SET [0] IMPLICIT de
    // signedAttrs se re-etiqueta como SET universal (0x31); forge ya
    // capturó los hijos como nodos ASN.1, así que basta re-envolverlos.
    const retaggedSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, authAttrsNodes);
    dataToVerify = Buffer.from(asn1.toDer(retaggedSet).getBytes(), 'binary');
  } else {
    dataToVerify = Buffer.from(eContentBytes, 'binary');
  }

  const certsAsn1 = capture.certificates?.value ?? [];
  if (certsAsn1.length === 0) {
    return { ok: false, reason: 'El token no incluye certificados; no se puede verificar la firma' };
  }
  const wantedSerialHex = normalizeSerialHex(forge.util.bytesToHex(capture.serial));
  const certNode = findSignerCertificate(certsAsn1, wantedSerialHex, capture.issuer);
  if (!certNode) {
    return { ok: false, reason: 'No se encontró en el token el certificado del firmante (issuer+serial)' };
  }
  const tbs = certNode.value[0];

  if (!hasCriticalTimestampingEku(tbs)) {
    return { ok: false, reason: 'El certificado del firmante no tiene la EKU id-kp-timeStamping crítica y exclusiva' };
  }

  let x509;
  try {
    const certDer = Buffer.from(asn1.toDer(certNode).getBytes(), 'binary');
    x509 = new X509Certificate(certDer);
  } catch (e) {
    return { ok: false, reason: `No se pudo leer el certificado del firmante: ${e.message}` };
  }

  if (genTime) {
    const genTimeMs = Date.parse(genTime);
    const notBeforeMs = Date.parse(x509.validFrom);
    const notAfterMs = Date.parse(x509.validTo);
    if (!Number.isNaN(genTimeMs) && (genTimeMs < notBeforeMs || genTimeMs > notAfterMs)) {
      return { ok: false, reason: 'El certificado del firmante no estaba vigente en genTime' };
    }
  }

  let sigOk;
  try {
    sigOk = cryptoVerify(digestHashName, dataToVerify, x509.publicKey, signatureBytes);
  } catch (e) {
    return { ok: false, reason: `Fallo al verificar la firma: ${e.message}` };
  }
  if (!sigOk) {
    return { ok: false, reason: 'La firma CMS del TimeStampToken no es válida' };
  }

  // Comprobación funcional adicional: el hash sellado (messageImprint del
  // TSTInfo) debe ser el packageHash del expediente.
  const mi = tst.value[2].value;
  const hashAlgo = asn1.derToOid(mi[0].value[0].value);
  const hashedHex = Buffer.from(mi[1].value, 'binary').toString('hex');
  if (hashAlgo !== OID_SHA256) {
    return { ok: false, reason: `Algoritmo de hash del messageImprint no soportado: ${hashAlgo}` };
  }
  if (hashedHex !== expectedPackageHashHex) {
    return { ok: false, reason: 'El hash sellado no coincide con packageHash' };
  }

  return { ok: true, genTime };
}

const dir = process.argv[2];
if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error('Uso: node verify.mjs <carpeta-del-expediente>');
  process.exit(2);
}

const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass, detail });

// ---------- canónico (mismo algoritmo que el BFF) ----------
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((a, k) => ((a[k] = sortDeep(v[k])), a), {});
  }
  return v;
}
const canonical = (v) => JSON.stringify(sortDeep(v));
const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- cargar ----------
const manifest = JSON.parse(readFileSync(join(dir, 'manifiesto.json'), 'utf8'));
const body = manifest.body ?? manifest; // tolera ambos formatos
const pdf = existsSync(join(dir, 'documento-firmado.pdf'))
  ? readFileSync(join(dir, 'documento-firmado.pdf'))
  : null;
const pubPem = existsSync(join(dir, 'manifiesto.pub.pem'))
  ? readFileSync(join(dir, 'manifiesto.pub.pem'), 'utf8')
  : null;
const tsr = existsSync(join(dir, 'tsa-token.tsr')) ? readFileSync(join(dir, 'tsa-token.tsr')) : null;
const caRoot = existsSync(join(dir, 'ca', 'root.cert.pem'))
  ? readFileSync(join(dir, 'ca', 'root.cert.pem'), 'utf8')
  : null;
const caInt = existsSync(join(dir, 'ca', 'intermediate.cert.pem'))
  ? readFileSync(join(dir, 'ca', 'intermediate.cert.pem'), 'utf8')
  : null;

// ---------- 1. manifestHash ----------
const recomputedHash = sha256hex(Buffer.from(canonical(body)));
ok('manifestHash', recomputedHash === manifest.manifestHash, `${recomputedHash.slice(0, 16)}…`);

// ---------- 2. firma Ed25519 ----------
if (manifest.manifestSignature && pubPem) {
  let sigOk = false;
  try {
    sigOk = edVerify(
      null,
      Buffer.from(canonical(body)),
      createPublicKey(pubPem),
      Buffer.from(manifest.manifestSignature, 'base64'),
    );
  } catch (e) {
    ok('firmaEd25519', false, e.message);
  }
  if (results.at(-1)?.name !== 'firmaEd25519') ok('firmaEd25519', sigOk);
} else {
  ok('firmaEd25519', false, 'falta firma o clave pública');
}

// ---------- 3. cadena de custodia ----------
{
  let prev = body.originalHash;
  let chainOk = Array.isArray(body.chainOfCustody);
  for (let i = 0; i < (body.chainOfCustody?.length ?? 0); i++) {
    const ev = body.chainOfCustody[i];
    const data = JSON.stringify({
      action: 'SIGNATURE_APPLIED',
      actorId: ev.actorId,
      at: ev.at,
      method: body.signatures?.[i]?.method,
    });
    const after = sha256hex(prev + data);
    if (after !== ev.hashAfter) chainOk = false;
    prev = after;
  }
  ok('cadenaDeCustodia', chainOk, `${body.chainOfCustody?.length ?? 0} eslabón(es)`);
}

// ---------- 4. signedHash / packageHash ----------
{
  const det = [...(body.signatures ?? [])]
    .map((s) => ({ signerId: s.signerId, signedAt: s.signedAt, usedMethod: s.method ?? null }))
    .sort((a, b) => a.signerId.localeCompare(b.signerId));
  const signedHash = sha256hex(JSON.stringify(det));
  ok('signedHash', signedHash === body.signedHash, 'recomputado');
  const packageHash = sha256hex(`${body.manifestId}${body.signedHash}${body.documentId}`);
  ok('packageHash', packageHash === body.packageHash, 'recomputado');
}

// ---------- 5. PDF PAdES / PKCS#7 ----------
if (pdf) {
  try {
    const s = pdf.toString('latin1');
    const hasSig = s.includes('/ByteRange') && s.includes('/Type /Sig');
    const m = s.match(/Contents\s*<([0-9A-Fa-f]+)>/);
    let chainOk = 'sin-CA';
    if (m) {
      const der = Buffer.from(m[1].replace(/0+$/, '').replace(/[^0-9a-f]/gi, ''), 'hex');
      const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der.toString('binary')));
      const certs = p7.certificates ?? [];
      const leaf = certs.find((c) => c.subject.getField('OU')?.value === 'Prestige Firmantes');
      if (leaf && caRoot && caInt) {
        const store = forge.pki.createCaStore([
          forge.pki.certificateFromPem(caRoot),
          forge.pki.certificateFromPem(caInt),
        ]);
        try {
          forge.pki.verifyCertificateChain(store, [leaf, forge.pki.certificateFromPem(caInt), forge.pki.certificateFromPem(caRoot)]);
          chainOk = true;
        } catch {
          chainOk = false;
        }
      }
    }
    ok('firmaPAdES', hasSig && chainOk !== false, `estructura=${hasSig} cadena=${chainOk}`);
  } catch (e) {
    ok('firmaPAdES', false, e.message);
  }
} else {
  ok('firmaPAdES', false, 'falta documento-firmado.pdf');
}

// ---------- 6. sello RFC 3161 ----------
// Verifica la firma criptográfica CMS SignedData del token (no solo que el
// messageImprint coincida con packageHash) — de lo contrario cualquiera
// puede fabricar un ContentInfo→SignedData→TSTInfo con el hash correcto y
// pasar esta comprobación sin haber pedido nunca un sello real a una TSA.
if (tsr) {
  try {
    const result = verifyRfc3161Signature(tsr, body.packageHash);
    const detail = result.ok
      ? `genTime=${result.genTime} · firma CMS verificada sobre packageHash`
      : result.reason;
    ok('selloRFC3161', result.ok, detail);
  } catch (e) {
    ok('selloRFC3161', false, e.message);
  }
} else {
  ok('selloRFC3161', 'n/a', 'sin token TSA en el expediente');
}

// ---------- reporte ----------
console.log(`\nExpediente: ${dir}`);
console.log(`Manifiesto: ${body.manifestId}  ·  documento ${body.documentId} v${body.documentVersion}\n`);
let failed = 0;
for (const r of results) {
  const mark = r.pass === true ? '  OK  ' : r.pass === 'n/a' ? ' n/a  ' : ' FALLA';
  if (r.pass !== true && r.pass !== 'n/a') failed++;
  console.log(`[${mark}] ${r.name.padEnd(18)} ${r.detail}`);
}
console.log('');
if (failed === 0) {
  console.log('RESULTADO: expediente VÁLIDO — todas las comprobaciones pasan.');
  process.exit(0);
} else {
  console.log(`RESULTADO: expediente NO VÁLIDO — ${failed} comprobación(es) fallaron.`);
  process.exit(1);
}
