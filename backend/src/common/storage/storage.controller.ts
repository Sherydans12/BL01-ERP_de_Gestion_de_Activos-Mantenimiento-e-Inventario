import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ActivityAction } from '@prisma/client';
import { JwtAuthGuard } from '../../features/auth/guards/jwt-auth.guard';
import { StorageService } from './storage.service';
import { AuditService } from '../audit/audit.service';

@Controller('storage')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get('resolve')
  async resolveAndRedirect(
    @Query('key') key: string,
    @Req()
    req: {
      user?: { id?: string; tenantId?: string };
      ip?: string;
      headers?: Record<string, unknown>;
    },
    @Res() res: Response,
  ) {
    const keyRaw = key?.trim();
    if (!keyRaw) {
      throw new BadRequestException('key es obligatorio');
    }
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException(
        'No se pudo resolver el tenant del usuario.',
      );
    }

    const allowed = await this.storage.canTenantReadStorageKey(
      tenantId,
      keyRaw,
    );
    if (!allowed) {
      throw new ForbiddenException('Sin permisos para acceder al archivo.');
    }

    const auditTarget = await this.storage.resolveAuditTargetForStorageKey(
      tenantId,
      keyRaw,
    );
    if (auditTarget && req.user?.id) {
      await this.audit.log({
        userId: req.user.id,
        tenantId,
        entityType: auditTarget.entityType,
        entityId: auditTarget.entityId,
        action: ActivityAction.FILE_ACCESS,
        oldValue: null,
        newValue: { storageKey: auditTarget.storageKey },
        ipAddress: req.ip,
        userAgent:
          typeof req.headers?.['user-agent'] === 'string'
            ? req.headers['user-agent']
            : undefined,
      });
    }

    const url = await this.storage.getReadOnlyUrl(keyRaw);
    return res.redirect(302, url);
  }
}
