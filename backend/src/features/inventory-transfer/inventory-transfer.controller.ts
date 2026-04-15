import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CreateInventoryTransferDto } from './inventory-transfer.service';
import { InventoryTransferService } from './inventory-transfer.service';

@Controller('inventory-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryTransferController {
  constructor(
    private readonly inventoryTransferService: InventoryTransferService,
  ) {}

  @Get()
  list(@Req() req: any) {
    return this.inventoryTransferService.listTransfers(req.user);
  }

  @Post()
  @Roles('ADMIN', 'SUPERVISOR', 'SUPER_ADMIN')
  execute(@Body() dto: CreateInventoryTransferDto, @Req() req: any) {
    return this.inventoryTransferService.executeTransfer(dto, req.user);
  }

  @Post(':id/receive')
  confirmReception(@Param('id') id: string, @Req() req: any) {
    return this.inventoryTransferService.confirmReception(id, req.user);
  }
}
