import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Authenticator } from 'otplib';
import {
  decryptTotpSecret,
  encryptTotpSecret,
} from './totp-secret-crypto';

const TOTP_ISSUER = 'BaseLogic TPM';
/** Ventana de pasos de 30s aceptada a cada lado (1 = ±30s desfase de reloj). */
const DEFAULT_TOTP_WINDOW_STEPS = 1;
const MAX_TOTP_WINDOW_STEPS = 5;

@Injectable()
export class TotpService {
  private readonly authenticator: Authenticator;

  constructor(private readonly config: ConfigService) {
    this.authenticator = new Authenticator();
    const raw = this.config.get<string>('TOTP_WINDOW_STEPS', '');
    const parsed = parseInt(String(raw || DEFAULT_TOTP_WINDOW_STEPS), 10);
    const window = Number.isFinite(parsed)
      ? Math.min(
          MAX_TOTP_WINDOW_STEPS,
          Math.max(0, parsed),
        )
      : DEFAULT_TOTP_WINDOW_STEPS;
    this.authenticator.options = {
      crypto,
      step: 30,
      window,
    };
  }

  private getKeyMaterial(): string {
    const k = this.config.get<string>('TOTP_ENCRYPTION_KEY', '');
    if (k && k.length >= 16) return k;
    const jwt = this.config.get<string>('JWT_SECRET', 'default');
    return `totp-wrap:${jwt}`;
  }

  encryptSecret(plainBase32: string): string {
    return encryptTotpSecret(plainBase32, this.getKeyMaterial());
  }

  decryptSecret(stored: string | null | undefined): string {
    if (!stored) throw new Error('TOTP no configurado');
    return decryptTotpSecret(stored, this.getKeyMaterial());
  }

  generateSecret(): string {
    return this.authenticator.generateSecret();
  }

  keyUri(accountEmail: string, secretBase32: string): string {
    return this.authenticator.keyuri(accountEmail, TOTP_ISSUER, secretBase32);
  }

  verify(token: string, secretPlainBase32: string): boolean {
    const t = String(token).replace(/\s/g, '');
    if (t.length < 6) return false;
    return this.authenticator.verify({ token: t, secret: secretPlainBase32 });
  }
}
