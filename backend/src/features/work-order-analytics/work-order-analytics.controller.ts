import {
  Controller,
  Get,
  Query,
  Req,
  Headers,
  UseGuards,
  StreamableFile,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { WorkOrderAnalyticsService } from './work-order-analytics.service';
import { assertUserHasContractAccess } from '../purchases/purchase-contract-access.util';

type WoAnalyticsRequest = {
  user: {
    tenantId: string;
    role?: string;
    allowedContracts?: string[];
  };
};

@Controller('work-order-analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkOrderAnalyticsController {
  constructor(private readonly analytics: WorkOrderAnalyticsService) {}

  @Get('dashboard')
  @RequirePermissions(SystemPermissions.OPERATIONS_WORK_ORDER_READ)
  dashboard(
    @Req() req: WoAnalyticsRequest,
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
    return this.analytics.getDashboard(
      req.user,
      from,
      to,
      activeContract && activeContract !== 'ALL' ? activeContract : undefined,
    );
  }

  @Get('projected-services')
  @RequirePermissions(SystemPermissions.OPERATIONS_WORK_ORDER_READ)
  projectedServices(
    @Req() req: WoAnalyticsRequest,
    @Query('limit') limit?: string,
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
    const lim = limit ? parseInt(limit, 10) : 200;
    return this.analytics.getProjectedServices(
      req.user,
      activeContract && activeContract !== 'ALL' ? activeContract : undefined,
      Number.isFinite(lim) ? lim : 200,
    );
  }

  @Get('report/monthly/pdf')
  @RequirePermissions(SystemPermissions.OPERATIONS_WORK_ORDER_UPDATE)
  monthlyManagementPdf(
    @Req() req: WoAnalyticsRequest,
    @Query('year') yearStr?: string,
    @Query('month') monthStr?: string,
    @Query('contractId') contractId?: string,
    @Headers('x-contract-id') contractHeader?: string,
    @Headers('x-site-id') siteHeader?: string,
  ): Promise<StreamableFile> {
    const activeContract =
      contractId?.trim() ||
      contractHeader?.trim() ||
      siteHeader?.trim() ||
      undefined;
    if (activeContract && activeContract !== 'ALL') {
      assertUserHasContractAccess(req.user, activeContract);
    }
    const year = parseInt(yearStr ?? '', 10);
    const month = parseInt(monthStr ?? '', 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      throw new BadRequestException('year y month son obligatorios');
    }
    return this.analytics
      .getMonthlyManagementPdf(
        req.user,
        year,
        month,
        activeContract && activeContract !== 'ALL' ? activeContract : undefined,
      )
      .then(({ buffer, filename }) => {
        return new StreamableFile(buffer, {
          type: 'application/pdf',
          disposition: `attachment; filename="${filename}"`,
        });
      });
  }
}
