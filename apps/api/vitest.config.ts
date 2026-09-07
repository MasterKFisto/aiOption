import { defineConfig, type Plugin } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolves `.js` import specifiers to their `.ts` sources (matching tsc/tsx
 * behavior for NodeNext-style imports).
 */
function resolveTsExtensions(): Plugin {
  return {
    name: 'resolve-ts-extensions',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.js')) return undefined;
      const tsPath = source.slice(0, -3) + '.ts';
      const importerDir = path.dirname(importer.split('?')[0] ?? '');
      const candidate = path.resolve(importerDir, tsPath);
      if (fs.existsSync(candidate)) return candidate;
      return this.resolve(tsPath, importer, { skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [resolveTsExtensions()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'],
  },
});