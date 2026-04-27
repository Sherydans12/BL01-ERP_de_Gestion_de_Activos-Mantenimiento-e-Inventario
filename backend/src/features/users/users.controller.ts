import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  Request,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { extractLoginMeta } from '../auth/auth-request.util';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MAX_USER_AVATAR_BYTES } from './user-avatar.constants';

const avatarUploadLimits = { limits: { fileSize: MAX_USER_AVATAR_BYTES } };

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard) // Aplicamos RolesGuard a nivel de controlador
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Últimos inicios de sesión exitosos (auditoría de cuenta). */
  @Get('me/login-activity')
  getMyLoginActivity(@Req() req: any) {
    return this.usersService.getMyLoginActivity(req.user.id);
  }

  /** Perfil del usuario autenticado (sin contraseña). */
  @Get('me')
  getMe(@Req() req: any) {
    return this.usersService.getMe(req.user.id);
  }

  @Put('profile')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Post('profile/avatar')
  @UseInterceptors(FileInterceptor('file', avatarUploadLimits))
  uploadAvatar(
    @Req() req: any,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    return this.usersService.uploadAvatar(req.user.id, file);
  }

  @Post('change-password')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(
      req.user.id,
      dto.oldPassword,
      dto.newPassword,
      extractLoginMeta(req),
    );
  }

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
  @Roles('ADMIN', 'SUPER_ADMIN')
  async resendActivation(@Param('id') id: string, @Request() req: any) {
    return this.usersService.resendActivation(
      id,
      req.user.tenantId,
      req.user.role,
    );
  }
}
