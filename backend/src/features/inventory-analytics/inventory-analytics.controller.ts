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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { InventoryAnalyticsService } from './inventory-analytics.service';
import { parseFullReportQuery } from './parse-full-report-query.util';

@Controller('inventory-analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryAnalyticsController {
  constructor(
    private readonly inventoryAnalyticsService: InventoryAnalyticsService,
  ) {}

  @Get('valuation')
  @RequirePermissions(SystemPermissions.INVENTORY_ANALYTICS_READ)
  valuation(@Req() req: { user: { tenantId: string } }) {
    return this.inventoryAnalyticsService.getValuationByFamily(req.user);
  }

  /**
   * Resumen por familia (panel de valorización): PDF o Excel.
   * ?format=pdf | xlsx
   */
  @Get('valuation-report')
  @RequirePermissions(SystemPermissions.INVENTORY_ANALYTICS_READ)
  async valuationReport(
    @Req() req: { user: { tenantId: string } },
    @Query('format') format: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ) {
    const fmt = format === 'xlsx' ? 'xlsx' : 'pdf';
    const { buffer, filename, mimeType } =
      await this.inventoryAnalyticsService.getValuationSummaryReportBuffer(
        req.user,
        fmt,
      );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /** Catálogos y totales para configurar el reporte maestro en UI. */
  @Get('full-report/meta')
  @RequirePermissions(SystemPermissions.INVENTORY_ANALYTICS_REPORT)
  fullReportMeta(@Req() req: { user: { tenantId: string } }) {
    return this.inventoryAnalyticsService.getFullReportMeta(req.user);
  }

  /**
   * Reporte maestro de valorización (cierre contable): PDF o Excel.
   * Query: format, include* (secciones), warehouseIds, familyNames, onlyWithStock, *MaxRows
   */
  @Get('full-report')
  @RequirePermissions(SystemPermissions.INVENTORY_ANALYTICS_REPORT)
  async fullReport(
    @Req() req: { user: { tenantId: string } },
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: false }) res: Response,
  ) {
    const fmt = query.format === 'xlsx' ? 'xlsx' : 'pdf';
    const options = parseFullReportQuery(query);
    const { buffer, filename, mimeType } =
      await this.inventoryAnalyticsService.getFullReportBuffer(
        req.user,
        fmt,
        options,
      );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('vendors-performance')
  @RequirePermissions(SystemPermissions.INVENTORY_ANALYTICS_READ)
  vendorsPerformance(
    @Req() req: { user: { tenantId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.inventoryAnalyticsService.getVendorsPerformance(
      req.user.tenantId,
      { from, to },
    );
  }

  @Get('savings-variation')
  @RequirePermissions(SystemPermissions.INVENTORY_ANALYTICS_REPORT)
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
  @RequirePermissions(SystemPermissions.INVENTORY_ANALYTICS_READ)
  globalSearch(
    @Req() req: { user: { tenantId: string } },
    @Query('q') q?: string,
  ) {
    const query = q?.trim();
    if (!query) {
      throw new BadRequestException('Debe indicar un término de búsqueda.');
    }
    return this.inventoryAnalyticsService.globalSearch(req.user.tenantId, query);
  }
}
