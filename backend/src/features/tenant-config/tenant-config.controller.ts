import { Controller, Get, Body, Patch, UseGuards, Req } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';

@Controller('tenant-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get()
  getTenantConfig(@Req() req: any) {
    return this.tenantConfigService.getTenantConfig(req.user.tenantId);
  }

  @Patch()
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateTenantConfig(
    @Req() req: any,
    @Body() updateTenantConfigDto: UpdateTenantConfigDto,
  ) {
    return this.tenantConfigService.updateTenantConfig(
      req.user.tenantId,
      updateTenantConfigDto,
    );
  }
}
