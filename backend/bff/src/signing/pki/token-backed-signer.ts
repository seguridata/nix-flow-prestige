import { Signer } from '@signpdf/utils';
import forge from 'node-forge';

/**
 * Arma el mismo PKCS#7 detached que `P12Signer`, pero la operación RSA
 * la hace quien implementa `signRsaPkcs1`. Ahí entra el token: recibe el
 * DigestInfo y devuelve la firma. Este proceso no ve la llave privada.
 *
 * El mecanismo del token tiene que ser CKM_RSA_PKCS, no CKM_SHA256_RSA_PKCS.
 * El DigestInfo ya incluye el SHA-256; volver a hashear lo invalidaría.
 */
export class TokenBackedSigner extends Signer {
  constructor(
    private readonly options: {
      certificates: forge.pki.Certificate[];
      leaf: forge.pki.Certificate;
      signRsaPkcs1: (digestInfo: Buffer) => Buffer;
    },
  ) {
    super();
  }

  override async sign(pdfBuffer: Buffer, signingTime?: Date): Promise<Buffer> {
    if (!Buffer.isBuffer(pdfBuffer)) {
      throw new Error('PDF expected as Buffer.');
    }
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(pdfBuffer.toString('binary'));
    for (const certificate of this.options.certificates) {
      p7.addCertificate(certificate);
    }
    const signRsaPkcs1 = this.options.signRsaPkcs1;
    p7.addSigner({
      key: {
        sign(md: { digest(): { getBytes(): string } }) {
          const digestInfo = sha256DigestInfo(md.digest().getBytes());
          const signature = signRsaPkcs1(Buffer.from(digestInfo, 'binary'));
          if (signature.length === 0) {
            throw new Error('El token devolvió una firma vacía.');
          }
          return signature.toString('binary');
        },
      } as forge.pki.rsa.PrivateKey,
      certificate: this.options.leaf,
      digestAlgorithm: forge.pki.oids.sha256,
      // El .d.ts dice string. P12Signer pasa Date y forge lo codifica como UTCTime.
      // Conservar el Date mantiene el PKCS#7 idéntico al del custodio de software.
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.signingTime, value: (signingTime ?? new Date()) as unknown as string },
        { type: forge.pki.oids.messageDigest },
      ],
    });
    p7.sign({ detached: true });
    return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
  }
}

/** EMSA-PKCS1-v1_5 DigestInfo de SHA-256, el mismo envoltorio que node-forge. */
function sha256DigestInfo(digestBytes: string): string {
  const oidBytes = forge.asn1.oidToDer(forge.pki.oids.sha256).getBytes();
  const digestAlgorithm = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, oidBytes),
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
  ]);
  const digest = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, digestBytes);
  const digestInfo = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    digestAlgorithm,
    digest,
  ]);
  return forge.asn1.toDer(digestInfo).getBytes();
}
