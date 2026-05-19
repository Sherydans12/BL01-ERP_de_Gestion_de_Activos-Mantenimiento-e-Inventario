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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import type {
  CreateInventoryTransferDto,
  ListInventoryTransfersQuery,
} from './inventory-transfer.service';
import { InventoryTransferService } from './inventory-transfer.service';

@Controller('inventory-transfers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryTransferController {
  constructor(
    private readonly inventoryTransferService: InventoryTransferService,
  ) {}

  @Get()
  @RequirePermissions(SystemPermissions.INVENTORY_TRANSFER_READ)
  list(@Req() req: any, @Query() query: ListInventoryTransfersQuery) {
    return this.inventoryTransferService.listTransfers(req.user, query);
  }

  @Post()
  @RequirePermissions(SystemPermissions.INVENTORY_TRANSFER_CREATE)
  execute(@Body() dto: CreateInventoryTransferDto, @Req() req: any) {
    return this.inventoryTransferService.executeTransfer(dto, req.user);
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.INVENTORY_TRANSFER_READ)
  getOne(@Param('id') id: string, @Req() req: any) {
    return this.inventoryTransferService.getTransferById(id, req.user);
  }

  @Post(':id/receive')
  @RequirePermissions(SystemPermissions.INVENTORY_TRANSFER_APPROVE)
  confirmReception(@Param('id') id: string, @Req() req: any) {
    return this.inventoryTransferService.confirmReception(id, req.user);
  }
}
