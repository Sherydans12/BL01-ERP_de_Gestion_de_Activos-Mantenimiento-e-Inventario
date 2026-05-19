import {
  Controller,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { Prisma } from '@prisma/client';

@Controller('subcontracts')
@UseGuards(JwtAuthGuard)
export class SubcontractsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_CONTRACT_MANAGE)
  async create(
    @Body() body: { name: string; code: string; contractId: string },
    @Req() req: any,
  ) {
    return this.prisma.subcontract.create({ data: body });
  }

  @Put(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_CONTRACT_MANAGE)
  async update(
    @Param('id') id: string,
    @Body() body: { name: string; code: string },
    @Req() req: any,
  ) {
    return this.prisma.subcontract.update({ where: { id }, data: body });
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_CONTRACT_MANAGE)
  async remove(@Param('id') id: string, @Req() req: any) {
    try {
      return await this.prisma.subcontract.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new ConflictException(
            'No se puede eliminar este subcontrato porque tiene equipos (activos) u otros registros asociados.',
          );
        }
        if (error.code === 'P2025') {
          throw new NotFoundException('El subcontrato no existe.');
        }
      }
      throw error;
    }
  }
}
