import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: any) {
    return this.authService.login(body.tenantCode, body.email, body.password);
  }

  @Post('activate')
  activate(@Body() body: any) {
    return this.authService.activateAccount(body.token, body.password);
  }
}
