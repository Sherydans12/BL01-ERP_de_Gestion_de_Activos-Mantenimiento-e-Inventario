export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  /** Origen público del front (sin barra final). OG / canonical / Twitter. */
  siteUrl: 'http://localhost:4200',
  /** Registrar @angular/service-worker (requiere build con serviceWorker en angular.json). */
  serviceWorker: true,
  /** Clave pública VAPID (debe coincidir con VAPID_PUBLIC_KEY del backend). */
  vapidPublicKey:
    'BLKNyILoKsp7pZFOoJT47L3_f2A3JdSYA4WN0ZUFwaK73Ugmxt6uSczU-EibTTOzjWkmirb99GAERSEUhouMTA0',
};
