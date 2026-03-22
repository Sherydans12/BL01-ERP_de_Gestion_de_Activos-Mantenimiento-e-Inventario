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
  ) {
    return this.equipmentsService.create(req.user, createEquipmentDto, siteId);
  }

  @Get()
  findAll(
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('brand') brand?: string,
    @Query('search') search?: string,
  ) {
    return this.equipmentsService.findAll(req.user, siteId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type,
      brand,
      search,
    });
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.equipmentsService.findOne(req.user, id, siteId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateEquipmentDto: any,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.equipmentsService.update(
      req.user,
      id,
      updateEquipmentDto,
      siteId,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: any,
    @Headers('x-site-id') siteId?: string,
  ) {
    return this.equipmentsService.remove(req.user, id, siteId);
  }
}
