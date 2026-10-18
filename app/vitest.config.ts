import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // relatives-tree публикует ESM без расширений в импортах — Node сам его не загрузит,
    // поэтому пакет пропускается через трансформацию Vite.
    server: { deps: { inline: ['relatives-tree'] } },
  },
});
