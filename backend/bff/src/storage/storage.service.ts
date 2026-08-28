import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

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

  get enabled() {
    return this.client !== null;
  }

  async putPdf(bytes: Buffer, filename: string): Promise<{ objectKey: string; hash: string }> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const objectKey = `docs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${filename}`;
    if (!this.client) return { objectKey, hash };
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: bytes,
          ContentType: 'application/pdf',
        }),
      );
    } catch (error) {
      this.log.warn(`MinIO put falló, se conserva base64 local: ${(error as Error).message}`);
    }
    return { objectKey, hash };
  }

  async presign(objectKey: string, seconds = 120): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
        { expiresIn: seconds },
      );
    } catch {
      return null;
    }
  }
}
