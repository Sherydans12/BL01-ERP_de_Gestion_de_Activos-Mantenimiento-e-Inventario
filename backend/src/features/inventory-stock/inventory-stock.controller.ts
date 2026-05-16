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

@Controller('inventory-stock')
@UseGuards(JwtAuthGuard)
export class InventoryStockController {
  constructor(private readonly inventoryStockService: InventoryStockService) {}

  /** Alertas de abastecimiento: stock ≤ mínimo (todas las bodegas del tenant). */
  @Get('supply-alerts')
  getSupplyAlerts(@Req() req: any) {
    return this.inventoryStockService.getSupplyAlerts(req.user);
  }

  /** IRA: exactitud de inventario (ajustes por conteo vs stock, últimos 30 días). */
  @Get('inventory-record-accuracy')
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

  // Obtener todo el stock de una bodega específica
  @Get('warehouse/:warehouseId')
  getStock(
    @Param('warehouseId') warehouseId: string,
    @Req() req: any,
    @Query('location') location?: string,
  ) {
    return this.inventoryStockService.getStockByWarehouse(
      warehouseId,
      req.user,
      { location: location?.trim() || undefined },
    );
  }

  /** Hoja de conteo físico (PDF ciego: sin stock sistema). */
  @Get('warehouse/:warehouseId/physical-count-sheet/pdf')
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

  // Obtener el historial (Kárdex) de una bodega (opcional: filtrar por ítem)
  @Get('warehouse/:warehouseId/transactions')
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

  // Transacciones pendientes de regularización (stock negativo)
  @Get('pending')
  getPending(@Req() req: any) {
    return this.inventoryStockService.getPendingRegularizations(req.user);
  }

  // Conteo de transacciones pendientes
  @Get('pending/count')
  getPendingCount(@Req() req: any) {
    return this.inventoryStockService.getPendingCount(req.user);
  }

  // Ingresar un movimiento de stock (Ingreso, Salida, Ajuste)
  @Post('transaction')
  performTransaction(@Body() dto: PerformTransactionDto, @Req() req: any) {
    return this.inventoryStockService.performTransaction(dto, req.user);
  }

  // Devolución atómica vinculada a una OT
  @Post('return')
  performReturn(@Body() dto: PerformReturnDto, @Req() req: any) {
    return this.inventoryStockService.performReturn(dto, req.user);
  }

  // Actualizar stock mínimo/máximo por bodega + artículo
  @Put('warehouse/:warehouseId/item/:itemId/levels')
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
