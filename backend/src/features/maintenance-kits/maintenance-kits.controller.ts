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
import type { CreateKitDto } from './maintenance-kits.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('maintenance-kits')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MaintenanceKitsController {
  constructor(
    private readonly maintenanceKitsService: MaintenanceKitsService,
  ) {}

  @Get()
  @RequirePermissions(SystemPermissions.OPERATIONS_MAINTENANCE_READ)
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
  @RequirePermissions(SystemPermissions.OPERATIONS_MAINTENANCE_READ)
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.maintenanceKitsService.findOne(id, req.user);
  }

  @Post()
  @RequirePermissions(SystemPermissions.OPERATIONS_MAINTENANCE_MANAGE)
  create(@Body() dto: CreateKitDto, @Req() req: any) {
    return this.maintenanceKitsService.create(dto, req.user);
  }

  @Put(':id')
  @RequirePermissions(SystemPermissions.OPERATIONS_MAINTENANCE_MANAGE)
  update(@Param('id') id: string, @Body() dto: CreateKitDto, @Req() req: any) {
    return this.maintenanceKitsService.update(id, dto, req.user);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.OPERATIONS_MAINTENANCE_MANAGE)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.maintenanceKitsService.remove(id, req.user);
  }
}
