import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Headers,
} from '@nestjs/common';
import { EquipmentsService } from './equipments.service';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('equipments')
@UseGuards(JwtAuthGuard)
export class EquipmentsController {
  constructor(private readonly equipmentsService: EquipmentsService) {}

  @Post()
  create(
    @Body() createEquipmentDto: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.create(
      req.user,
      createEquipmentDto,
      activeContract,
    );
  }

  @Get()
  findAll(
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('brand') brand?: string,
    @Query('search') search?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.findAll(req.user, activeContract, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type,
      brand,
      search,
    });
  }

  @Get(':id/analytics')
  getAnalytics(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.getAnalytics(req.user, id, activeContract);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.findOne(req.user, id, activeContract);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateEquipmentDto: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.update(
      req.user,
      id,
      updateEquipmentDto,
      activeContract,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Headers('x-contract-id') contractId?: string,
  ) {
    const activeContract = contractId || siteId;
    return this.equipmentsService.remove(req.user, id, activeContract);
  }
}
