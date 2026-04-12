/** Cuerpo esperado (estándar Push API del navegador). */
export interface SubscribePushDto {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}
