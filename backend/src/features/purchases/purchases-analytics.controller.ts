import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  StreamableFile,
} from '@nestjs/common';
import { PurchasesAnalyticsService } from './purchases-analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { assertUserHasContractAccess } from './purchase-contract-access.util';

type PurchasesAnalyticsRequest = {
  user: {
    tenantId: string;
    role?: string;
    allowedContracts?: string[];
  };
};

@Controller('purchases/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasesAnalyticsController {
  constructor(private readonly analytics: PurchasesAnalyticsService) {}

  @Get('report/pdf')
  @RequirePermissions(SystemPermissions.PURCHASES_ANALYTICS_READ)
  async executiveReportPdf(
    @Req() req: PurchasesAnalyticsRequest,
    @Query('contractId') contractId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<StreamableFile> {
    if (contractId) {
      assertUserHasContractAccess(req.user, contractId);
    }
    const { buffer, filename } = await this.analytics.buildExecutiveReportPdf(
      req.user.tenantId,
      { contractId, from, to },
    );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('dashboard')
  @RequirePermissions(SystemPermissions.PURCHASES_ANALYTICS_READ)
  dashboard(
    @Req() req: PurchasesAnalyticsRequest,
    @Query('contractId') contractId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('excludeClosedRequisitions') excludeClosedRequisitions?: string,
  ) {
    if (contractId) {
      assertUserHasContractAccess(req.user, contractId);
    }
    return this.analytics.getDashboard(req.user.tenantId, {
      contractId,
      from,
      to,
      excludeClosedRequisitions: excludeClosedRequisitions !== 'false',
    });
  }
}
