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

@Controller('sites')
@UseGuards(JwtAuthGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  create(@Body() body: { name: string; code: string }, @Req() req: any) {
    if (req.user.role !== 'ADMIN')
      throw new UnauthorizedException(
        'Solo los administradores pueden gestionar faenas',
      );
    return this.sitesService.create(req.user.tenantId, body);
  }

  @Get()
  findAll(@Req() req: any) {
    // Si es ADMIN trae todas, si no, solo las asignadas?
    // El requerimiento dice: "Asegúrate de que solo el ADMIN pueda crear/editar"
    // Pero para leer vamos a dejar que lea todas las de su tenant o podríamos filtrar, pero layout ya filtra visualmente.
    return this.sitesService.findAll(req.user.tenantId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name: string; code: string; isActive?: boolean },
    @Req() req: any,
  ) {
    if (req.user.role !== 'ADMIN')
      throw new UnauthorizedException(
        'Solo los administradores pueden editar faenas',
      );
    return this.sitesService.update(req.user.tenantId, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    if (req.user.role !== 'ADMIN')
      throw new UnauthorizedException(
        'Solo los administradores pueden eliminar faenas',
      );
    return this.sitesService.remove(req.user.tenantId, id);
  }
}
