import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  createReadStream,
} from 'fs';
import { join, dirname } from 'path';
import type { Readable } from 'stream';

export interface StorageDriver {
  upload(key: string, buffer: Buffer, mimetype: string): Promise<string>;
  getUrl(key: string): string;
  delete(key: string): Promise<void>;
  readStream(key: string): Promise<Readable>;
}

export class LocalDriver implements StorageDriver {
  constructor(private readonly basePath: string) {
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
    }
  }

  async upload(key: string, buffer: Buffer, _mimetype: string): Promise<string> {
    const fullPath = join(this.basePath, key);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, buffer);
    return key;
  }

  getUrl(key: string): string {
    return `/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.basePath, key);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  }

  async readStream(key: string): Promise<Readable> {
    const fullPath = join(this.basePath, key);
    if (!existsSync(fullPath)) {
      const err = new Error(`ENOENT: ${key}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return createReadStream(fullPath);
  }
}
