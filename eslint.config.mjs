import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', '*.cjs', 'prisma/generated'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Um `any` vindo da rede corrompe o dominio em silencio: toda
      // fronteira externa valida com Zod antes de virar objeto de dominio.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // consistent-type-imports fica DESLIGADA de proposito: com
      // emitDecoratorMetadata, a injecao de dependencia do Nest precisa do
      // import como valor. Trocar por `import type` quebra a DI em runtime
      // sem que o compilador reclame — o pior tipo de erro.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
