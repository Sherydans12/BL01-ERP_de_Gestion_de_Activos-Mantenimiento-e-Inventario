import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { WorkOrdersService } from './work-orders.service';

@Controller('api/work-orders') // <-- http://localhost:3000/api/work-orders
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Post()
  create(@Body() createWorkOrderDto: any) {
    return this.workOrdersService.create(createWorkOrderDto);
  }

  @Get('stats')
  getStats() {
    return this.workOrdersService.getStats();
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('equipmentId') equipmentId?: string,
  ) {
    return this.workOrdersService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      dateFrom,
      dateTo,
      equipmentId,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workOrdersService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.workOrdersService.updateStatus(id, status);
  }
}
