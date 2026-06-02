import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { Observable } from 'rxjs';

type FileValidationPolicy = {
  maxBytes: number;
  allowedMimeTypes: ReadonlySet<string>;
};

const SECURITY_REJECTION_MESSAGE =
  'Tipo de archivo no permitido por políticas de seguridad';

/** Archivo en memoria (Multer) validado antes de persistir. */
type UploadedMemoryFile = {
  size: number;
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

const FALLBACK_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function normalizeExtension(filename: string): string | null {
  const lower = (filename || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0 || dot === lower.length - 1) return null;
  return lower.slice(dot + 1);
}

@Injectable()
export class FileValidationInterceptor implements NestInterceptor {
  constructor(private readonly policy: FileValidationPolicy) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context
      .switchToHttp()
      .getRequest<{ file?: UploadedMemoryFile }>();
    const file = request.file;
    if (!file) return next.handle();

    if (file.size > this.policy.maxBytes) {
      throw new BadRequestException(
        `El archivo supera el máximo permitido de ${Math.round(this.policy.maxBytes / (1024 * 1024))} MB`,
      );
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    const ext = normalizeExtension(file.originalname);
    const fallbackMime = ext ? FALLBACK_MIME_BY_EXT[ext] : null;
    const trustedMime = detected?.mime || fallbackMime || null;

    if (!trustedMime || !this.policy.allowedMimeTypes.has(trustedMime)) {
      throw new BadRequestException(SECURITY_REJECTION_MESSAGE);
    }

    // Normaliza mimetype para capas que persisten el valor en BD.
    file.mimetype = trustedMime;
    return next.handle();
  }
}

export const avatarUploadPolicy: FileValidationPolicy = {
  maxBytes: 5 * 1024 * 1024,
  allowedMimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp']),
};

export const documentUploadPolicy: FileValidationPolicy = {
  maxBytes: 20 * 1024 * 1024,
  allowedMimeTypes: new Set(['application/pdf', 'image/jpeg', 'image/png']),
};

/** Logo de marca tenant (sidebar, PDF OC): imágenes ligeras. */
export const tenantLogoUploadPolicy: FileValidationPolicy = {
  maxBytes: 2 * 1024 * 1024,
  allowedMimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp']),
};
