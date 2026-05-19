import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { MeterAdjustmentsService } from './meter-adjustments.service';

@Controller('meter-adjustments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeterAdjustmentsController {
  constructor(private readonly service: MeterAdjustmentsService) {}

  @Post()
  @RequirePermissions(SystemPermissions.OPERATIONS_METER_READING_CREATE)
  create(
    @Req() req: any,
    @Body()
    body: {
      equipmentId: string;
      oldValue: number;
      newValue: number;
      reason?: string;
    },
  ) {
    return this.service.create(req.user, body);
  }

  @Get()
  @RequirePermissions(SystemPermissions.OPERATIONS_METER_READING_READ)
  findByEquipment(@Req() req: any, @Query('equipmentId') equipmentId: string) {
    return this.service.findByEquipment(req.user, equipmentId);
  }
}
