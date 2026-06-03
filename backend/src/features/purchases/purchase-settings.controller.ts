import { Controller, Get, Put, Body, Req, UseGuards } from '@nestjs/common';
import { PurchaseSettingsService } from './purchase-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequirePermissions,
  RequireAnyPermissions,
} from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('purchase-settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseSettingsController {
  constructor(private readonly settingsService: PurchaseSettingsService) {}

  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_SETTING_READ)
  getSettings(@Req() req: any) {
    return this.settingsService.getSettings(req.user.tenantId);
  }

  @Put()
  @RequirePermissions(SystemPermissions.PURCHASES_SETTING_UPDATE)
  updateSettings(
    @Body()
    body: {
      approvalThreshold?: number;
      currency?: string;
      invoiceMatchTolerancePercent?: number;
    },
    @Req() req: any,
  ) {
    return this.settingsService.updateSettings(req.user.tenantId, body);
  }

  @Get('policies')
  @RequireAnyPermissions(
    SystemPermissions.PURCHASES_SETTING_READ,
    SystemPermissions.PURCHASES_ORDER_APPROVE,
  )
  getPolicies(@Req() req: any) {
    return this.settingsService.getPolicies(req.user.tenantId);
  }

  @Put('policies')
  @RequirePermissions(SystemPermissions.PURCHASES_SETTING_UPDATE)
  upsertPolicies(
    @Body()
    body: {
      policies: Array<{
        level: number;
        description?: string;
        userIds: string[];
        minAmount?: number;
      }>;
    },
    @Req() req: any,
  ) {
    return this.settingsService.upsertPolicies(
      req.user.tenantId,
      body.policies,
    );
  }
}
