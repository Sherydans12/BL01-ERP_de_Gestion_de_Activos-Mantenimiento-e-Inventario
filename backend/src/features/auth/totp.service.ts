import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import {
  decryptTotpSecret,
  encryptTotpSecret,
} from './totp-secret-crypto';

const TOTP_ISSUER = 'BaseLogic TPM';

@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService) {}

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
    return authenticator.generateSecret();
  }

  keyUri(accountEmail: string, secretBase32: string): string {
    return authenticator.keyuri(accountEmail, TOTP_ISSUER, secretBase32);
  }

  verify(token: string, secretPlainBase32: string): boolean {
    const t = String(token).replace(/\s/g, '');
    if (t.length < 6) return false;
    return authenticator.verify({ token: t, secret: secretPlainBase32 });
  }
}
