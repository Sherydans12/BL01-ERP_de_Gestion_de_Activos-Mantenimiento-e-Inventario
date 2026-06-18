import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { InventoryStockService } from './inventory-stock.service';
import type {
  PerformTransactionDto,
  PerformReturnDto,
  UpdateStockLevelsDto,
} from './inventory-stock.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('inventory-stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryStockController {
  constructor(private readonly inventoryStockService: InventoryStockService) {}

  /** Alertas de abastecimiento: stock ≤ mínimo (todas las bodegas del tenant). */
  @Get('supply-alerts')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getSupplyAlerts(@Req() req: any) {
    return this.inventoryStockService.getSupplyAlerts(req.user);
  }

  /** IRA: exactitud de inventario (ajustes por conteo vs stock, últimos 30 días). */
  @Get('inventory-record-accuracy')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getInventoryRecordAccuracy(
    @Req() req: any,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventoryStockService.getInventoryRecordAccuracy(req.user, {
      warehouseId: warehouseId?.trim() || undefined,
    });
  }

  /** Auditoría: saldos negativos o con marca de regularización pendiente (paginado). */
  @Get('warehouse/:warehouseId/pending-regularization')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getPendingRegularizationPage(
    @Param('warehouseId') warehouseId: string,
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.inventoryStockService.getPendingRegularizationPage(
      warehouseId,
      req.user,
      {
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 25,
      },
    );
  }

  /** Ubicación y saldo actual para un ítem en bodega (movimientos manuales). */
  @Get('warehouse/:warehouseId/item/:itemId/stock-position')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getStockPosition(
    @Param('warehouseId') warehouseId: string,
    @Param('itemId') itemId: string,
    @Req() req: any,
  ) {
    return this.inventoryStockService.getStockPosition(
      warehouseId,
      itemId,
      req.user,
    );
  }

  /** Desglose de reservas de stock (OT) para un ítem en bodega. */
  @Get('warehouse/:warehouseId/item/:itemId/reservations')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  listStockReservations(
    @Param('warehouseId') warehouseId: string,
    @Param('itemId') itemId: string,
    @Req() req: any,
  ) {
    return this.inventoryStockService.listStockReservationsForItem(
      warehouseId,
      itemId,
      req.user,
    );
  }

  @Get('warehouse/:warehouseId')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getStock(
    @Param('warehouseId') warehouseId: string,
    @Req() req: any,
    @Query('location') location?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('familyId') familyId?: string,
    @Query('subcategoryId') subcategoryId?: string,
    @Query('status') status?: string,
  ) {
    if (page || pageSize || search || sort || dir || familyId || subcategoryId || status) {
      return this.inventoryStockService.getStockByWarehousePaginated(
        warehouseId,
        req.user,
        {
          location: location?.trim() || undefined,
          page: page ? parseInt(page, 10) : 1,
          pageSize: pageSize ? parseInt(pageSize, 10) : 25,
          search: search?.trim() || undefined,
          sort: sort?.trim() || undefined,
          dir: dir === 'desc' ? 'desc' : 'asc',
          familyId: familyId?.trim() || undefined,
          subcategoryId: subcategoryId?.trim() || undefined,
          status: status?.trim() || undefined,
        },
      );
    }
    return this.inventoryStockService.getStockByWarehouse(
      warehouseId,
      req.user,
      { location: location?.trim() || undefined },
    );
  }

  /** Hoja de conteo físico (PDF ciego: sin stock sistema). */
  @Get('warehouse/:warehouseId/physical-count-sheet/pdf')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  async physicalCountSheetPdf(
    @Param('warehouseId') warehouseId: string,
    @Req() req: any,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.inventoryStockService.buildPhysicalCountSheetPdf(
        req.user,
        warehouseId,
      );
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('warehouse/:warehouseId/transactions')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getTransactions(
    @Param('warehouseId') warehouseId: string,
    @Req() req: any,
    @Query('itemId') itemId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parseNum = (s?: string) => {
      const n = s !== undefined ? Number.parseInt(s, 10) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    return this.inventoryStockService.getTransactionsByWarehouse(
      warehouseId,
      req.user,
      {
        itemId: itemId?.trim() || undefined,
        page: parseNum(page),
        pageSize: parseNum(pageSize),
      },
    );
  }

  @Get('pending')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getPending(@Req() req: any) {
    return this.inventoryStockService.getPendingRegularizations(req.user);
  }

  @Get('pending/count')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_READ)
  getPendingCount(@Req() req: any) {
    return this.inventoryStockService.getPendingCount(req.user);
  }

  @Post('transaction')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_ADJUST)
  performTransaction(@Body() dto: PerformTransactionDto, @Req() req: any) {
    return this.inventoryStockService.performTransaction(dto, req.user);
  }

  @Post('return')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_ADJUST)
  performReturn(@Body() dto: PerformReturnDto, @Req() req: any) {
    return this.inventoryStockService.performReturn(dto, req.user);
  }

  @Put('warehouse/:warehouseId/item/:itemId/levels')
  @RequirePermissions(SystemPermissions.INVENTORY_STOCK_ADJUST)
  updateStockLevels(
    @Param('warehouseId') warehouseId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateStockLevelsDto,
    @Req() req: any,
  ) {
    return this.inventoryStockService.updateStockLevels(
      warehouseId,
      itemId,
      dto,
      req.user,
    );
  }
}
