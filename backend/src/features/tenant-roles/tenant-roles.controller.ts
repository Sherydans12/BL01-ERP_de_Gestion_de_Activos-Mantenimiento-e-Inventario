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
import { TenantRolesService } from './tenant-roles.service';
import { CreateTenantRoleDto } from './dto/create-tenant-role.dto';
import { UpdateTenantRoleDto } from './dto/update-tenant-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('tenant-roles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantRolesController {
  constructor(private readonly tenantRolesService: TenantRolesService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.tenantRolesService.findAll(req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Req() req: any, @Body() dto: CreateTenantRoleDto) {
    return this.tenantRolesService.create(req.user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTenantRoleDto,
  ) {
    return this.tenantRolesService.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.tenantRolesService.remove(req.user.tenantId, id);
  }
}
