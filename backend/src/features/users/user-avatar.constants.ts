/** Carpeta bajo UPLOAD_PATH para avatares de usuario (StorageService). */
export const USER_AVATAR_STORAGE_FOLDER = 'user-avatars';

/** Máximo 5 MB por imagen de perfil. */
export const MAX_USER_AVATAR_BYTES = 5 * 1024 * 1024;

export const USER_AVATAR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
