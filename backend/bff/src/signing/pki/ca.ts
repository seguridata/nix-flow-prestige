import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import forge from 'node-forge';

/**
 * CA X.509 interna del proyecto: raíz autofirmada + intermedia. La firma
 * DIGITAL usa un certificado hoja emitido por la intermedia. Sustituible por
 * el PKI de SeguriData vía el puerto `KeyCustodian` (PKCS#11).
 *
 * Todo el material vive bajo `PKI_DIR` (por defecto `backend/bff/pki/`), que
 * está en `.gitignore`. Nunca se versiona.
 */

export interface CaChain {
  rootCert: forge.pki.Certificate;
  intermediateCert: forge.pki.Certificate;
  intermediateKey: forge.pki.rsa.PrivateKey;
  rootCertPem: string;
  intermediateCertPem: string;
}

const YEAR = 365 * 24 * 3600 * 1000;

function attrs(cn: string, ou: string) {
  return [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'SeguriData' },
    { name: 'organizationalUnitName', value: ou },
    { name: 'countryName', value: 'MX' },
  ];
}

function serial(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(16));
}

/** Genera raíz + intermedia bajo `dir` si no existen. Idempotente. */
export function ensureCaChain(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const paths = {
    rootKey: join(dir, 'root.key.pem'),
    rootCert: join(dir, 'root.cert.pem'),
    intKey: join(dir, 'intermediate.key.pem'),
    intCert: join(dir, 'intermediate.cert.pem'),
  };
  if (Object.values(paths).every((p) => existsSync(p))) return;

  // --- Raíz ---
  const rootKeys = forge.pki.rsa.generateKeyPair(4096);
  const root = forge.pki.createCertificate();
  root.publicKey = rootKeys.publicKey;
  root.serialNumber = serial();
  root.validity.notBefore = new Date(Date.now() - 3600_000);
  root.validity.notAfter = new Date(Date.now() + 15 * YEAR);
  root.setSubject(attrs('Prestige Root CA', 'PKI'));
  root.setIssuer(attrs('Prestige Root CA', 'PKI'));
  root.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  root.sign(rootKeys.privateKey, forge.md.sha384.create());

  // --- Intermedia ---
  const intKeys = forge.pki.rsa.generateKeyPair(3072);
  const inter = forge.pki.createCertificate();
  inter.publicKey = intKeys.publicKey;
  inter.serialNumber = serial();
  inter.validity.notBefore = new Date(Date.now() - 3600_000);
  inter.validity.notAfter = new Date(Date.now() + 8 * YEAR);
  inter.setSubject(attrs('Prestige Issuing CA', 'PKI'));
  inter.setIssuer(root.subject.attributes);
  inter.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  inter.sign(rootKeys.privateKey, forge.md.sha384.create());

  writeFileSync(paths.rootKey, forge.pki.privateKeyToPem(rootKeys.privateKey), { mode: 0o600 });
  writeFileSync(paths.rootCert, forge.pki.certificateToPem(root));
  writeFileSync(paths.intKey, forge.pki.privateKeyToPem(intKeys.privateKey), { mode: 0o600 });
  writeFileSync(paths.intCert, forge.pki.certificateToPem(inter));
}

export function loadCaChain(dir: string): CaChain {
  const rootCertPem = readFileSync(join(dir, 'root.cert.pem'), 'utf8');
  const intermediateCertPem = readFileSync(join(dir, 'intermediate.cert.pem'), 'utf8');
  const intermediateKeyPem = readFileSync(join(dir, 'intermediate.key.pem'), 'utf8');
  return {
    rootCert: forge.pki.certificateFromPem(rootCertPem),
    intermediateCert: forge.pki.certificateFromPem(intermediateCertPem),
    intermediateKey: forge.pki.privateKeyFromPem(intermediateKeyPem) as forge.pki.rsa.PrivateKey,
    rootCertPem,
    intermediateCertPem,
  };
}

export interface IssuedLeaf {
  keyPem: string;
  certPem: string;
  cert: forge.pki.Certificate;
}

/** Emite un certificado de firma (no repudio) para un firmante. */
export function issueLeaf(
  ca: CaChain,
  params: { signerId: string; commonName: string; email?: string; validityDays?: number },
): IssuedLeaf {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 3600_000);
  cert.validity.notAfter = new Date(Date.now() + (params.validityDays ?? 3 * 365) * 24 * 3600 * 1000);
  cert.setSubject([
    { name: 'commonName', value: params.commonName },
    { name: 'organizationName', value: 'SeguriData' },
    { name: 'organizationalUnitName', value: 'Prestige Firmantes' },
    { name: 'countryName', value: 'MX' },
    ...(params.email ? [{ name: 'emailAddress', value: params.email }] : []),
  ]);
  cert.setIssuer(ca.intermediateCert.subject.attributes);
  const extensions: Record<string, unknown>[] = [
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
    { name: 'extKeyUsage', emailProtection: true, clientAuth: true },
    { name: 'subjectKeyIdentifier' },
  ];
  if (params.email) {
    extensions.push({ name: 'subjectAltName', altNames: [{ type: 1, value: params.email }] });
  }
  cert.setExtensions(extensions);
  cert.sign(ca.intermediateKey, forge.md.sha256.create());
  return { keyPem: forge.pki.privateKeyToPem(keys.privateKey), certPem: forge.pki.certificateToPem(cert), cert };
}

/** Empaqueta llave + cadena en un PKCS#12 (DER) cifrado con `passphrase`. */
export function buildP12(leaf: IssuedLeaf, ca: CaChain, passphrase: string): Buffer {
  const key = forge.pki.privateKeyFromPem(leaf.keyPem);
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, [leaf.cert, ca.intermediateCert, ca.rootCert], passphrase, {
    algorithm: '3des',
    friendlyName: 'Prestige Signer',
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}
