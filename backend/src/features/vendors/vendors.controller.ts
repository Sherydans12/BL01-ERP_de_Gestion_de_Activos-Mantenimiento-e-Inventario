import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';

@Controller('vendors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @RequirePermissions(SystemPermissions.PURCHASES_VENDOR_READ)
  findAll(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactiveRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    const parseOptionalPositiveInt = (
      raw: string | undefined,
    ): number | undefined => {
      if (raw === undefined || raw === '') return undefined;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return this.vendorsService.findAll(req.user.tenantId, {
      search,
      includeInactive: includeInactiveRaw === 'true',
      page: parseOptionalPositiveInt(pageRaw),
      pageSize: parseOptionalPositiveInt(pageSizeRaw),
      sort,
      dir,
    });
  }

  @Get(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_VENDOR_READ)
  findById(@Param('id') id: string, @Req() req: any) {
    return this.vendorsService.findById(id, req.user.tenantId);
  }

  @Post()
  @RequirePermissions(SystemPermissions.PURCHASES_VENDOR_CREATE)
  create(@Body() body: any, @Req() req: any) {
    return this.vendorsService.create(body, req.user.tenantId);
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_VENDOR_UPDATE)
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.vendorsService.update(id, body, req.user.tenantId);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.PURCHASES_VENDOR_DELETE)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.vendorsService.remove(id, req.user.tenantId);
  }
}
