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
import { JwtAuthGuard } from '../../features/auth/guards/jwt-auth.guard';
import { StorageService } from './storage.service';

@Controller('storage')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('resolve')
  async resolveAndRedirect(
    @Query('key') key: string,
    @Req() req: { user?: { tenantId?: string } },
    @Res() res: Response,
  ) {
    const keyRaw = key?.trim();
    if (!keyRaw) {
      throw new BadRequestException('key es obligatorio');
    }
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('No se pudo resolver el tenant del usuario.');
    }

    const allowed = await this.storage.canTenantReadStorageKey(tenantId, keyRaw);
    if (!allowed) {
      throw new ForbiddenException('Sin permisos para acceder al archivo.');
    }

    const url = await this.storage.getReadOnlyUrl(keyRaw);
    return res.redirect(302, url);
  }
}
