import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type {
  CreateInventoryTransferDto,
  ListInventoryTransfersQuery,
} from './inventory-transfer.service';
import { InventoryTransferService } from './inventory-transfer.service';

@Controller('inventory-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryTransferController {
  constructor(
    private readonly inventoryTransferService: InventoryTransferService,
  ) {}

  @Get()
  list(@Req() req: any, @Query() query: ListInventoryTransfersQuery) {
    return this.inventoryTransferService.listTransfers(req.user, query);
  }

  @Post()
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  execute(@Body() dto: CreateInventoryTransferDto, @Req() req: any) {
    return this.inventoryTransferService.executeTransfer(dto, req.user);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Req() req: any) {
    return this.inventoryTransferService.getTransferById(id, req.user);
  }

  @Post(':id/receive')
  confirmReception(@Param('id') id: string, @Req() req: any) {
    return this.inventoryTransferService.confirmReception(id, req.user);
  }
}
