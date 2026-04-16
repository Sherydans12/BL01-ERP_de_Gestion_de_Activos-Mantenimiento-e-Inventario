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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { assertUserHasContractAccess } from './purchase-contract-access.util';

type PurchasesAnalyticsRequest = {
  user: {
    tenantId: string;
    role?: string;
    allowedContracts?: string[];
  };
};

@Controller('purchases/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasesAnalyticsController {
  constructor(private readonly analytics: PurchasesAnalyticsService) {}

  @Get('report/pdf')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
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
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
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
