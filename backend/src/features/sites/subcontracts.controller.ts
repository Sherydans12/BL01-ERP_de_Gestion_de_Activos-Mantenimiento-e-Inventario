import {
  Controller,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Prisma } from '@prisma/client';

@Controller('subcontracts')
@UseGuards(JwtAuthGuard)
export class SubcontractsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(
    @Body() body: { name: string; code: string; contractId: string },
    @Req() req: any,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException(
        'Solo administradores pueden gestionar subcontratos',
      );
    }
    return this.prisma.subcontract.create({ data: body });
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name: string; code: string },
    @Req() req: any,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException(
        'Solo administradores pueden gestionar subcontratos',
      );
    }
    return this.prisma.subcontract.update({ where: { id }, data: body });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException(
        'Solo administradores pueden gestionar subcontratos',
      );
    }

    try {
      return await this.prisma.subcontract.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Error P2003: Violación de llave foránea (Tiene equipos asociados)
        if (error.code === 'P2003') {
          throw new ConflictException(
            'No se puede eliminar este subcontrato porque tiene equipos (activos) u otros registros asociados.',
          );
        }
        // Error P2025: El registro no existe
        if (error.code === 'P2025') {
          throw new NotFoundException('El subcontrato no existe.');
        }
      }
      // Si es otro error raro, lo lanzamos para que quede en los logs
      throw error;
    }
  }
}
