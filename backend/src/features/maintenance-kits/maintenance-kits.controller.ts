import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Query,
  Headers,
} from '@nestjs/common';
import { MaintenanceKitsService } from './maintenance-kits.service';
import type { CreateKitDto } from './maintenance-kits.service'; // <--- LA SOLUCIÓN ESTÁ AQUÍ
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('maintenance-kits')
@UseGuards(JwtAuthGuard)
export class MaintenanceKitsController {
  constructor(
    private readonly maintenanceKitsService: MaintenanceKitsService,
  ) {}

  @Get()
  findAll(
    @Req() req: any,
    @Headers('x-contract-id') activeContract?: string,
    @Query('brand') brand?: string,
    @Query('model') model?: string,
  ) {
    return this.maintenanceKitsService.findAll(
      req.user,
      activeContract,
      brand,
      model,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.maintenanceKitsService.findOne(id, req.user);
  }

  @Post()
  create(@Body() dto: CreateKitDto, @Req() req: any) {
    return this.maintenanceKitsService.create(dto, req.user);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateKitDto, @Req() req: any) {
    return this.maintenanceKitsService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.maintenanceKitsService.remove(id, req.user);
  }
}
