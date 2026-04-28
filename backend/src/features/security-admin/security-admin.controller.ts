import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SecurityAdminService } from './security-admin.service';

@Controller('admin/security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class SecurityAdminController {
  constructor(private readonly securityAdmin: SecurityAdminService) {}

  private ctx(req: any) {
    return {
      tenantId: (req.user?.tenantId as string | null | undefined) ?? null,
      role: req.user?.role as string,
    };
  }

  @Get('dashboard-stats')
  dashboardStats(@Req() req: any) {
    return this.securityAdmin.getDashboardStats(this.ctx(req));
  }

  @Get('suspicious-auth')
  listSuspicious(@Req() req: any) {
    return this.securityAdmin.listSuspiciousAuthLogs(this.ctx(req));
  }

  @Get('active-sessions')
  activeSessions(@Req() req: any) {
    return this.securityAdmin.listActiveSessionsForTenant(this.ctx(req));
  }

  @Get('global-auth-settings')
  getGlobalAuthSettings(@Req() req: any) {
    return this.securityAdmin.getGlobalAuthSettings({
      role: req.user?.role as string,
    });
  }

  @Patch('global-auth-settings')
  @Roles('SUPER_ADMIN')
  updateGlobalAuthSettings(
    @Body() body: { superAdminStepUpEmailEnabled?: boolean },
    @Req() req: any,
  ) {
    if (typeof body?.superAdminStepUpEmailEnabled !== 'boolean') {
      throw new BadRequestException(
        'Se requiere superAdminStepUpEmailEnabled (booleano).',
      );
    }
    return this.securityAdmin.updateGlobalAuthSettings(
      { superAdminStepUpEmailEnabled: body.superAdminStepUpEmailEnabled },
      { role: req.user?.role as string },
    );
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(@Param('id') id: string, @Req() req: any) {
    await this.securityAdmin.adminRevokeSession(id, this.ctx(req));
    return { ok: true };
  }
}
