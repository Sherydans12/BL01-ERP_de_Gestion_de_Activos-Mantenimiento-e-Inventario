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
  BadRequestException,
} from '@nestjs/common';
import { WorkOrdersService } from './work-orders.service';
import type { UpdateWorkOrderDto } from './work-orders.service';
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
    @Headers('x-contract-id') contractHeader?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('equipmentId') equipmentId?: string,
  ) {
    const activeContract = siteId || contractHeader;
    return this.workOrdersService.findAll(req.user, activeContract, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
      dateFrom,
      dateTo,
      equipmentId,
    });
  }

  @Get('backlog')
  listBacklog(
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractHeader?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
  ) {
    const activeContract = siteId || contractHeader;
    const st = status === 'PENDING' || status === 'DONE' ? status : undefined;
    return this.workOrdersService.listBacklog(req.user, activeContract, st, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      search,
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
    @Body()
    body: {
      status: string;
      warehouseId?: string;
      closureEquipmentOperational?: boolean;
    },
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.workOrdersService.updateStatus(req.user, id, body, siteId);
  }

  @Patch(':id/backlog/:itemId')
  patchBacklogItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { status: 'PENDING' | 'DONE' },
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.workOrdersService.patchBacklogItem(
      req.user,
      id,
      itemId,
      body,
      siteId,
    );
  }

  @Patch(':id')
  updateWorkOrder(
    @Param('id') id: string,
    @Body() dto: UpdateWorkOrderDto,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.workOrdersService.update(req.user, id, dto, siteId);
  }

  @Post(':id/backlog')
  addBacklogItem(
    @Param('id') id: string,
    @Body() body: { description: string },
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.workOrdersService.addBacklogItem(
      req.user,
      id,
      body.description,
      siteId,
    );
  }

  @Post(':id/backlog/:itemId/promote')
  promoteBacklogItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { mode: 'TO_TASK' | 'TO_NEW_OT' },
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    if (body?.mode !== 'TO_TASK' && body?.mode !== 'TO_NEW_OT') {
      throw new BadRequestException('Body.mode debe ser TO_TASK o TO_NEW_OT');
    }
    return this.workOrdersService.promoteBacklogItem(
      req.user,
      id,
      itemId,
      body,
      siteId,
    );
  }
}
