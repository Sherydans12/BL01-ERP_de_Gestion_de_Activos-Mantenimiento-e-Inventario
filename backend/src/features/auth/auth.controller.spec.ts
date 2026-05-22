import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { UserSessionService } from './user-session.service';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            activateAccount: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            recordLogoutAudit: jest.fn(),
          },
        },
        { provide: CaptchaService, useValue: { create: jest.fn() } },
        { provide: UserSessionService, useValue: { revokeAllForUser: jest.fn() } },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get(AuthController);
  });

  it('debe instanciarse', () => {
    expect(controller).toBeDefined();
  });
});
