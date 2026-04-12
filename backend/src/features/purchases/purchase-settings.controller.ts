import {
  Controller,
  Get,
  Put,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PurchaseSettingsService } from './purchase-settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('purchase-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class PurchaseSettingsController {
  constructor(private readonly settingsService: PurchaseSettingsService) {}

  @Get()
  getSettings(@Req() req: any) {
    return this.settingsService.getSettings(req.user.tenantId);
  }

  @Put()
  updateSettings(@Body() body: any, @Req() req: any) {
    return this.settingsService.updateSettings(req.user.tenantId, body);
  }

  @Get('policies')
  getPolicies(@Req() req: any) {
    return this.settingsService.getPolicies(req.user.tenantId);
  }

  @Put('policies')
  upsertPolicies(@Body() body: { policies: any[] }, @Req() req: any) {
    return this.settingsService.upsertPolicies(
      req.user.tenantId,
      body.policies,
    );
  }
}
