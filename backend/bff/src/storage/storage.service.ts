import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { decryptObject, encryptObject, type EncMeta } from './object-crypto';

export interface StoredObject {
  objectKey: string;
  sha256: string; // hash del contenido EN CLARO (es el `hash` del documento)
  sizeBytes: number;
  enc: EncMeta;
}

/**
 * Object storage S3-compatible (MinIO en el sandbox). Obligatorio: no hay
 * fallback a base64 en la base de datos. Todo objeto se cifra en reposo con
 * *envelope encryption* AES-256-GCM (ver `object-crypto.ts`); la lectura
 * devuelve el contenido descifrado y el BFF lo sirve por HTTP autenticado.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    this.bucket = process.env.S3_BUCKET ?? 'prestige-docs';
    this.client = endpoint
      ? new S3Client({
          region: process.env.S3_REGION ?? 'us-east-1',
          endpoint,
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY ?? 'prestige',
            secretAccessKey: process.env.S3_SECRET_KEY ?? 'prestige-minio',
          },
        })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  private require(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Object storage no configurado (falta S3_ENDPOINT). El BFF no puede almacenar documentos.',
      );
    }
    return this.client;
  }

  /** Sube `bytes` cifrados bajo `<prefix>/<yyyy-mm-dd>/<uuid>-<filename>`. */
  async putObject(opts: {
    prefix: string;
    filename: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    const client = this.require();
    const sha256 = createHash('sha256').update(opts.bytes).digest('hex');
    const safeName = opts.filename.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'objeto';
    const objectKey = `${opts.prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
    const { ciphertext, enc } = encryptObject(opts.bytes);

    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: ciphertext,
        ContentType: 'application/octet-stream',
        Metadata: {
          'x-prestige-content-type': opts.contentType,
          'x-prestige-sha256': sha256,
          'x-prestige-enc': 'AES-256-GCM',
        },
      }),
    );

    return { objectKey, sha256, sizeBytes: opts.bytes.length, enc };
  }

  /** Descarga y descifra el objeto; devuelve el contenido en claro. */
  async getObject(objectKey: string, enc: EncMeta): Promise<Buffer> {
    const client = this.require();
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!res.Body) throw new ServiceUnavailableException(`Objeto ${objectKey} sin cuerpo`);
    const ciphertext = Buffer.from(await res.Body.transformToByteArray());
    return decryptObject(ciphertext, enc);
  }

  async deleteObject(objectKey: string): Promise<void> {
    const client = this.require();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  /**
   * URL prefirmada al objeto crudo (cifrado). Reservada para cuando se use SSE
   * nativo del storage; hoy el contenido se sirve descifrado por el BFF.
   */
  async presignRaw(objectKey: string, seconds = 120): Promise<string> {
    return getSignedUrl(
      this.require(),
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: seconds },
    );
  }
}
