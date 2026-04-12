import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('vendors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.vendorsService.findAll(req.user.tenantId);
  }

  @Get(':id')
  findById(@Param('id') id: string, @Req() req: any) {
    return this.vendorsService.findById(id, req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() body: any, @Req() req: any) {
    return this.vendorsService.create(body, req.user.tenantId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.vendorsService.update(id, body, req.user.tenantId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.vendorsService.remove(id, req.user.tenantId);
  }
}
