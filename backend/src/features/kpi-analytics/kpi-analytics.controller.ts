import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { assertUserHasContractAccess } from '../purchases/purchase-contract-access.util';
import { KpiAnalyticsService } from './kpi-analytics.service';

type KpiRequest = {
  user: {
    id: string;
    tenantId: string;
    role?: string;
    allowedContracts?: string[];
  };
};

@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KpiAnalyticsController {
  constructor(private readonly kpiAnalytics: KpiAnalyticsService) {}

  @Get('kpi-dashboard')
  @RequirePermissions(SystemPermissions.OPERATIONS_WORK_ORDER_READ)
  kpiDashboard(
    @Req() req: KpiRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('contractId') contractId?: string,
    @Headers('x-contract-id') contractHeader?: string,
    @Headers('x-site-id') siteHeader?: string,
  ) {
    const activeContract =
      contractId?.trim() ||
      contractHeader?.trim() ||
      siteHeader?.trim() ||
      undefined;
    if (activeContract && activeContract !== 'ALL') {
      assertUserHasContractAccess(req.user, activeContract);
    }
    if (!from?.trim() || !to?.trim()) {
      throw new BadRequestException('Parámetros from y to son obligatorios');
    }
    return this.kpiAnalytics.getKpiDashboard(
      req.user,
      from,
      to,
      activeContract && activeContract !== 'ALL' ? activeContract : undefined,
    );
  }
}
