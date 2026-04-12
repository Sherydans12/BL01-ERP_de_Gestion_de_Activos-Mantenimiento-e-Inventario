import { ConfigService } from '@nestjs/config';
import type { Readable } from 'stream';
import { StorageDriver } from './local.driver';

/**
 * Stub preparado para migración a S3.
 * Activar con STORAGE_DRIVER=s3 y configurar AWS_* env vars.
 */
export class S3Driver implements StorageDriver {
  private bucket: string;
  private region: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get('AWS_S3_BUCKET', '');
    this.region = config.get('AWS_REGION', 'us-east-1');
  }

  async upload(key: string, _buffer: Buffer, _mimetype: string): Promise<string> {
    // TODO: Implementar con @aws-sdk/client-s3
    throw new Error(
      `S3 driver not yet implemented. Configure STORAGE_DRIVER=local or implement S3 upload for bucket: ${this.bucket}`,
    );
  }

  getUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async delete(_key: string): Promise<void> {
    // TODO: Implementar con @aws-sdk/client-s3
    throw new Error('S3 driver delete not yet implemented.');
  }

  async readStream(_key: string): Promise<Readable> {
    throw new Error('S3 driver readStream not yet implemented.');
  }
}
