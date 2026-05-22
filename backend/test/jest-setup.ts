/**
 * Mocks globales para Jest (ESM en node_modules que ts-jest no transforma por defecto).
 */
jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn().mockResolvedValue({
    mime: 'image/png',
    ext: 'png',
  }),
}));
