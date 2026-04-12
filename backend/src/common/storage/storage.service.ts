import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'stream';
import { StorageDriver, LocalDriver } from './drivers/local.driver';
import { S3Driver } from './drivers/s3.driver';

@Injectable()
export class StorageService {
  private driver: StorageDriver;

  constructor(private readonly config: ConfigService) {
    const driverType = config.get('STORAGE_DRIVER', 'local');
    this.driver =
      driverType === 's3'
        ? new S3Driver(config)
        : new LocalDriver(config.get('UPLOAD_PATH', './uploads'));
  }

  async uploadFile(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    folder: string,
  ): Promise<string> {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${folder}/${Date.now()}-${safeName}`;
    return this.driver.upload(key, file.buffer, file.mimetype);
  }

  getFileUrl(key: string): string {
    return this.driver.getUrl(key);
  }

  async deleteFile(key: string): Promise<void> {
    return this.driver.delete(key);
  }

  async getFileStream(key: string): Promise<Readable> {
    return this.driver.readStream(key);
  }
}
