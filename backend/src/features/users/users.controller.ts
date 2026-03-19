import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard) // Aplicamos RolesGuard a nivel de controlador
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  create(@Body() body: any, @Req() req: any) {
    const requesterTenantId = req.user.tenantId;
    return this.usersService.create(body, requesterTenantId);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  findAll(
    @Req() req: any,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ) {
    const { tenantId, role } = req.user;
    return this.usersService.findAll(tenantId, role, page, limit);
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const requesterTenantId = req.user.tenantId;
    const requesterRole = req.user.role;
    return this.usersService.update(id, body, requesterTenantId, requesterRole);
  }

  @Delete(':id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  remove(@Param('id') id: string, @Req() req: any) {
    const requesterTenantId = req.user.tenantId;
    const requesterRole = req.user.role;
    return this.usersService.remove(id, requesterTenantId, requesterRole);
  }

  @Post(':id/resend-activation')
  async resendActivation(@Param('id') id: string, @Request() req: any) {
    return this.usersService.resendActivation(
      id,
      req.user.tenantId,
      req.user.role,
    );
  }
}
