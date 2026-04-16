import { MulterModuleOptions } from '@nestjs/platform-express';
import { MAX_UPLOAD_FILE_BYTES } from './file-upload.constants';

export function multerUploadOptions(): MulterModuleOptions {
  return {
    limits: {
      fileSize: MAX_UPLOAD_FILE_BYTES,
      files: 10,
    },
  };
}
