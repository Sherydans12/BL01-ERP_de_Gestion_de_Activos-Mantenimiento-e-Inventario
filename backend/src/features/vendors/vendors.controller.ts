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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('vendors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
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
  findById(@Param('id') id: string, @Req() req: any) {
    return this.vendorsService.findById(id, req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
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
