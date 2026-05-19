// backend/src/features/sites/sites.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { SitesService } from './sites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_CONTRACT_MANAGE)
  create(@Body() body: { name: string; code: string }, @Req() req: any) {
    return this.sitesService.create(req.user.tenantId, body);
  }

  /** Listado para layout y módulos operativos (filtrado por allowedContracts en cliente). */
  @Get()
  findAll(@Req() req: any) {
    return this.sitesService.findAll(req.user.tenantId);
  }

  @Put(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_CONTRACT_MANAGE)
  update(
    @Param('id') id: string,
    @Body() body: { name: string; code: string; isActive?: boolean },
    @Req() req: any,
  ) {
    return this.sitesService.update(req.user.tenantId, id, body);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_CONTRACT_MANAGE)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.sitesService.remove(req.user.tenantId, id);
  }
}
