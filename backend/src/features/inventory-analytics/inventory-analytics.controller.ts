import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InventoryAnalyticsService } from './inventory-analytics.service';

@Controller('inventory-analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryAnalyticsController {
  constructor(
    private readonly inventoryAnalyticsService: InventoryAnalyticsService,
  ) {}

  @Get('valuation')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  valuation(@Req() req: { user: { tenantId: string } }) {
    return this.inventoryAnalyticsService.getValuationByFamily(req.user);
  }

  /**
   * Reporte maestro de valorización (cierre contable): PDF o Excel.
   * ?format=pdf | xlsx
   */
  @Get('full-report')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async fullReport(
    @Req() req: { user: { tenantId: string } },
    @Query('format') format: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ) {
    const fmt = format === 'xlsx' ? 'xlsx' : 'pdf';
    const { buffer, filename, mimeType } =
      await this.inventoryAnalyticsService.getFullReportBuffer(req.user, fmt);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('vendors-performance')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  vendorsPerformance(
    @Req() req: { user: { tenantId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.inventoryAnalyticsService.getVendorsPerformance(
      req.user.tenantId,
      {
        from,
        to,
      },
    );
  }

  @Get('savings-variation')
  @Roles('ADMIN', 'SUPER_ADMIN')
  savingsVariation(
    @Req() req: { user: { tenantId: string } },
    @Query('month') month?: string,
  ) {
    return this.inventoryAnalyticsService.getSavingsVariation(
      req.user.tenantId,
      month,
    );
  }

  @Get('global-search')
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  globalSearch(
    @Req() req: { user: { tenantId: string } },
    @Query('q') q?: string,
  ) {
    const query = q?.trim();
    if (!query) {
      throw new BadRequestException('Debe indicar un término de búsqueda.');
    }
    return this.inventoryAnalyticsService.globalSearch(
      req.user.tenantId,
      query,
    );
  }
}
