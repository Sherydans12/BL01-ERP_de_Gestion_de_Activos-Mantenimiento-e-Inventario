/**
 * otplib v8 no publica tipos en @types/otplib; stub mínimo para el uso en TotpService.
 */
declare module 'otplib' {
  export const authenticator: {
    generateSecret(): string;
    keyuri(
      user: string,
      service: string,
      secret: string,
    ): string;
    verify(options: { token: string; secret: string }): boolean;
  };
}
