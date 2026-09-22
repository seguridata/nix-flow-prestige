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
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import forge from 'node-forge';

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

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
if (tsr) {
  try {
    const root = forge.asn1.fromDer(tsr.toString('binary'));
    const sd = root.value[1].value[0].value;
    const encap = sd[2].value;
    const tst = forge.asn1.fromDer(encap[1].value[0].value);
    const mi = tst.value[2].value;
    const hashAlgo = forge.asn1.derToOid(mi[0].value[0].value);
    const hashed = Buffer.from(mi[1].value, 'binary').toString('hex');
    const genTime = tst.value[4].value;
    const tsOk = hashAlgo === OID_SHA256 && hashed === body.packageHash;
    ok('selloRFC3161', tsOk, `genTime=${genTime} sobre packageHash=${tsOk}`);
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
