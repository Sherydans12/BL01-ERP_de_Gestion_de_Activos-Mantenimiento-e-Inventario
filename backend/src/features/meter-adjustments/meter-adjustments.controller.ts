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
import { MeterAdjustmentsService } from './meter-adjustments.service';

@Controller('meter-adjustments')
@UseGuards(JwtAuthGuard)
export class MeterAdjustmentsController {
  constructor(private readonly service: MeterAdjustmentsService) {}

  @Post()
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
  findByEquipment(@Req() req: any, @Query('equipmentId') equipmentId: string) {
    return this.service.findByEquipment(req.user, equipmentId);
  }
}
