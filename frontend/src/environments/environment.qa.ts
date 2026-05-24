/**
 * QA / staging — sustituido en build Docker vía ARG (ver frontend/Dockerfile).
 * Placeholders: __QA_API_URL__, __QA_SITE_URL__, __QA_VAPID_PUBLIC_KEY__
 */
export const environment = {
  production: true,
  apiUrl: '__QA_API_URL__',
  siteUrl: '__QA_SITE_URL__',
  serviceWorker: true,
  vapidPublicKey: '__QA_VAPID_PUBLIC_KEY__',
};
