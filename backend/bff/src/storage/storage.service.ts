import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
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

/** Prefijos de clave que llevan el tenant como SEGUNDO segmento: `<prefijo>/<tenant>/...`. */
const TENANT_KEY_PREFIXES = new Set(['documents', 'templates', 'evidence', 'presented', 'onboarding']);

/**
 * Claves guardadas ANTES de que el tenant formara parte de la clave. Siguen
 * siendo datos válidos (la fila que las referencia ya se consultó filtrada por
 * tenant), así que se aceptan —con aviso— y no se bloquean descargas existentes:
 *  - `documents/<yyyy-mm-dd>/<uuid>-<nombre>`: documentos previos a 5659271 y
 *    el script `prisma/scripts/backfill-storage.ts` (prefijo plano 'documents').
 *  - `legacy/pendiente-de-backfill/<id>`: marcador de la migración de de-base64.
 *  - `onboarding/(ine|selfie)/<yyyy-mm-dd>/...`: INE/selfie previos a llevar tenant.
 */
const LEGACY_KEY_PATTERNS: RegExp[] = [
  /^documents\/\d{4}-\d{2}-\d{2}\//,
  /^legacy\/pendiente-de-backfill\//,
  /^onboarding\/(ine|selfie)\/\d{4}-\d{2}-\d{2}\//,
];

const keyLog = new Logger('StorageTenantKey');

/**
 * Defensa en profundidad: exige que una clave de objeto guardada en una fila
 * pertenezca al tenant que la pide (`documents|templates|evidence|presented|
 * onboarding/<tenantId>/...`). Las consultas por fila ya filtran por tenant;
 * esto evita leer/borrar un objeto ajeno si una fila quedara corrupta o mal
 * escrita. Si no cumple: error CLARO en el log (con tenant y clave) y
 * `NotFoundException` (404) al usuario, sin revelar nada. Las claves antiguas
 * sin tenant (ver `LEGACY_KEY_PATTERNS`) se aceptan con aviso.
 */
export function assertTenantKey(tenantId: string, objectKey: string): void {
  const segments = typeof objectKey === 'string' ? objectKey.split('/') : [];
  // Sin segmentos vacíos ni '.'/'..' (nada de recorridos de ruta).
  const wellFormed = segments.length >= 3 && segments.every((s) => s !== '' && s !== '.' && s !== '..');
  if (wellFormed && tenantId.length > 0 && TENANT_KEY_PREFIXES.has(segments[0]) && segments[1] === tenantId) return;
  if (wellFormed && LEGACY_KEY_PATTERNS.some((re) => re.test(objectKey))) {
    keyLog.warn(`Clave de storage antigua sin tenant (se permite): ${objectKey} (tenant ${tenantId})`);
    return;
  }
  keyLog.error(`Clave de storage NO pertenece al tenant "${tenantId}": ${objectKey}. Acceso denegado.`);
  throw new NotFoundException('Archivo no encontrado');
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
    const accessKeyId = process.env.S3_ACCESS_KEY?.trim() || undefined;
    const secretAccessKey = process.env.S3_SECRET_KEY?.trim() || undefined;
    if (endpoint && process.env.NODE_ENV === 'production') {
      // En producción no hay credenciales por defecto de MinIO de desarrollo.
      if (!accessKeyId || !secretAccessKey || accessKeyId === 'prestige' || secretAccessKey === 'prestige-minio') {
        throw new Error(
          'S3_ACCESS_KEY / S3_SECRET_KEY deben estar definidas y distintas de las de desarrollo (prestige / prestige-minio) en producción.',
        );
      }
    }
    this.bucket = process.env.S3_BUCKET ?? 'prestige-docs';
    this.client = endpoint
      ? new S3Client({
          region: process.env.S3_REGION ?? 'us-east-1',
          endpoint,
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
          credentials: {
            accessKeyId: accessKeyId ?? 'prestige',
            secretAccessKey: secretAccessKey ?? 'prestige-minio',
          },
        })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Comprobacion de conectividad real al bucket (HeadBucket) con timeout corto.
   * Nunca lanza: devuelve false si no esta configurado, falla o expira.
   */
  async ping(timeoutMs = 2000): Promise<boolean> {
    if (!this.client) return false;
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
      });
      await Promise.race([
        this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: ac.signal }),
        timeout,
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
