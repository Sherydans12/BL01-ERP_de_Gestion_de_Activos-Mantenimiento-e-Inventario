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
  UnauthorizedException,
} from '@nestjs/common';
import { SitesService } from './sites.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  create(@Body() body: { name: string; code: string }, @Req() req: any) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')
      throw new UnauthorizedException(
        'Solo los administradores pueden gestionar contratos',
      );
    return this.sitesService.create(req.user.tenantId, body);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.sitesService.findAll(req.user.tenantId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name: string; code: string; isActive?: boolean },
    @Req() req: any,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')
      throw new UnauthorizedException(
        'Solo los administradores pueden editar contratos',
      );
    return this.sitesService.update(req.user.tenantId, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')
      throw new UnauthorizedException(
        'Solo los administradores pueden eliminar contratos',
      );
    return this.sitesService.remove(req.user.tenantId, id);
  }
}
