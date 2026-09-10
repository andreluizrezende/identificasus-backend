/**
 * Fronteiras do monolito modular, verificadas em CI.
 * Uma importacao entre modulos que nao esteja declarada quebra o build.
 */
module.exports = {
  forbidden: [
    { name: 'sem-ciclos', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'auditoria-e-folha',
      comment: 'auditoria nao depende de nenhum outro modulo: todos dependem dela',
      severity: 'error',
      from: { path: '^src/modulos/auditoria' },
      to: { path: '^src/modulos/(?!auditoria)' },
    },
    {
      name: 'modulo-nao-abre-conexao',
      comment: 'todo acesso a banco passa por BancoPorFinalidade (ADR-14)',
      severity: 'error',
      from: { path: '^src/modulos' },
      // Tipos do driver sao permitidos (`import type`); abrir conexao, nao.
      // Quem cria pool e src/acesso/banco-por-finalidade.service.ts, e so ele.
      to: { path: '^node_modules/mysql2', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'ponte-pericial-destacavel',
      comment: 'nenhum modulo importa a implementacao da ponte pericial (RF-06.02)',
      severity: 'error',
      from: { path: '^src/(?!modulos/ponte-pericial)' },
      to: { path: '^src/modulos/ponte-pericial/(?!.*porta)' },
    },
    {
      name: 'comum-e-folha',
      severity: 'error',
      from: { path: '^src/comum' },
      to: { path: '^src/(modulos|acesso)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
