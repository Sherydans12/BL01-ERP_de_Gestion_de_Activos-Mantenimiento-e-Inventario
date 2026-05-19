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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { getPermissionsCatalog } from '../auth/constants/permissions-catalog';

@Controller('tenant-roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantRolesController {
  constructor(private readonly tenantRolesService: TenantRolesService) {}

  @Get('permissions-catalog')
  @RequirePermissions(SystemPermissions.ADMIN_USER_MANAGE_ROLES)
  getPermissionsCatalog() {
    return getPermissionsCatalog();
  }

  @Get()
  @RequirePermissions(SystemPermissions.ADMIN_USER_MANAGE_ROLES)
  findAll(@Req() req: any) {
    return this.tenantRolesService.findAll(req.user.tenantId);
  }

  @Post('ensure-defaults')
  @RequirePermissions(SystemPermissions.ADMIN_USER_MANAGE_ROLES)
  ensureDefaults(@Req() req: any) {
    return this.tenantRolesService.ensureDefaultsAndList(req.user.tenantId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.ADMIN_USER_MANAGE_ROLES)
  create(@Req() req: any, @Body() dto: CreateTenantRoleDto) {
    return this.tenantRolesService.create(req.user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.ADMIN_USER_MANAGE_ROLES)
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTenantRoleDto,
  ) {
    return this.tenantRolesService.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.ADMIN_USER_MANAGE_ROLES)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.tenantRolesService.remove(req.user.tenantId, id);
  }
}
