/**
 * otplib v8 no publica tipos; definición mínima para TotpService.
 */
declare module 'otplib' {
  export class Authenticator {
    options: {
      window?: number;
      step?: number;
      encoding?: string;
      epoch?: number | null;
      /** Requerido por otplib en Node (createHmac). */
      crypto?: { createHmac: (...args: unknown[]) => unknown };
    };
    generateSecret(byteLength?: number): string;
    keyuri(user: string, service: string, secret: string): string;
    verify(options: { token: string; secret: string }): boolean;
  }

  export const authenticator: Authenticator;
}
