import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UnitsOfMeasureService } from './units-of-measure.service';
import type { CreateUnitOfMeasureDto } from './units-of-measure.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('units-of-measure')
@UseGuards(JwtAuthGuard)
export class UnitsOfMeasureController {
  constructor(private readonly service: UnitsOfMeasureService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user);
  }

  @Post()
  create(@Body() dto: CreateUnitOfMeasureDto, @Req() req: any) {
    return this.service.create(dto, req.user);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreateUnitOfMeasureDto,
    @Req() req: any,
  ) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user);
  }
}
