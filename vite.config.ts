import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// O app é servido dentro de um iframe da Pipefy, a partir da URL do manifest.
// `base: './'` mantém todos os caminhos relativos, então o mesmo build funciona
// em qualquer host HTTPS (túnel ou hospedagem estática).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        // Página de `init_url`: só registra a feature, não renderiza UI.
        init: resolve(import.meta.dirname, 'index.html'),
        // Página do pipe-view: o dashboard em si.
        pipeView: resolve(import.meta.dirname, 'pipe-view.html'),
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
