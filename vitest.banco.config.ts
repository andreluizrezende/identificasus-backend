import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Testes que falam com o MySQL de verdade. Separados dos testes de unidade por
 * um motivo prático: `npm test` precisa rodar em qualquer máquina, e estes
 * precisam de banco. `npm run test:banco` só faz sentido onde `dbsamu` existe.
 *
 * Sem paralelismo entre arquivos: eles compartilham o mesmo banco, e a
 * completude do caso é conferida por valor.
 */
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/banco/**/*.banco.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
