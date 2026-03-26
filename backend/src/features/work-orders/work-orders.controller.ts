import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Headers,
} from '@nestjs/common';
import { WorkOrdersService } from './work-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('work-orders')
@UseGuards(JwtAuthGuard)
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Post()
  create(
    @Body() createWorkOrderDto: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.workOrdersService.create(req.user, createWorkOrderDto, siteId);
  }

  @Get('stats')
  getStats(@Req() req: any, @Headers('x-site-id') siteId?: string) {
    return this.workOrdersService.getStats(req.user, siteId);
  }

  @Get()
  findAll(
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('equipmentId') equipmentId?: string,
  ) {
    return this.workOrdersService.findAll(req.user, siteId, {
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
  findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.workOrdersService.findOne(req.user, id, siteId);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; warehouseId?: string },
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.workOrdersService.updateStatus(req.user, id, body, siteId);
  }
}
