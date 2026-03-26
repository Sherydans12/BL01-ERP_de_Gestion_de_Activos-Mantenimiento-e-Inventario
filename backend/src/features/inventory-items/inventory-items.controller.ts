import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { InventoryItemsService } from './inventory-items.service';
import type { CreateInventoryItemDto } from './inventory-items.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('inventory-items')
@UseGuards(JwtAuthGuard)
export class InventoryItemsController {
  constructor(private readonly inventoryItemsService: InventoryItemsService) {}

  @Post()
  create(@Body() dto: CreateInventoryItemDto, @Req() req: any) {
    return this.inventoryItemsService.create(dto, req.user);
  }

  @Get('search')
  search(@Query('q') q: string, @Req() req: any) {
    return this.inventoryItemsService.search(req.user, q);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.inventoryItemsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.findOne(id, req.user);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreateInventoryItemDto,
    @Req() req: any,
  ) {
    return this.inventoryItemsService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.inventoryItemsService.remove(id, req.user);
  }
}
