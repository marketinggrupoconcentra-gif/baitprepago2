import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Path alias: @/ → src/
      '@': path.resolve(__dirname, 'src'),
      // Mockear server-only en entorno de test
      'server-only': path.resolve(__dirname, 'tests/__mocks__/server-only.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**'],
      exclude: ['src/lib/**/*.d.ts'],
    },
  },
});
