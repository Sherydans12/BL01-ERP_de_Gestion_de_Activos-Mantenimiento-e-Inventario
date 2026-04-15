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

  // Obtener todo el stock de una bodega específica
  @Get('warehouse/:warehouseId')
  getStock(@Param('warehouseId') warehouseId: string, @Req() req: any) {
    return this.inventoryStockService.getStockByWarehouse(
      warehouseId,
      req.user,
    );
  }

  // Obtener el historial (Kárdex) de una bodega
  @Get('warehouse/:warehouseId/transactions')
  getTransactions(@Param('warehouseId') warehouseId: string, @Req() req: any) {
    return this.inventoryStockService.getTransactionsByWarehouse(
      warehouseId,
      req.user,
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
