import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// O script de producao e CommonJS (roda com `node`, sem build).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { separarInstrucoes } = require('../../scripts/aplicar-migracao.cjs') as {
  separarInstrucoes(texto: string, opcoes?: { pularGrants?: boolean }): { instrucoes: string[]; puladas: string[] };
};

describe('separador do script de migracao de producao', () => {
  it('(!) entende DELIMITER: a procedure inteira e uma instrucao so', () => {
    const r = separarInstrucoes([
      'DROP PROCEDURE IF EXISTS p;',
      'DELIMITER //',
      'CREATE PROCEDURE p() BEGIN',
      '  SELECT 1;',
      '  SELECT 2;',
      'END//',
      'DELIMITER ;',
      'SELECT 3;',
    ].join('\n'));
    expect(r.instrucoes).toHaveLength(3);
    expect(r.instrucoes[1]).toMatch(/^CREATE PROCEDURE p\(\) BEGIN[\s\S]*SELECT 2;\s*END$/);
  });

  it('nao corta em ";" dentro de aspas nem em comentario', () => {
    const r = separarInstrucoes("INSERT INTO t VALUES ('a;b'); -- comentario; com ponto e virgula\nSELECT 1;");
    expect(r.instrucoes).toEqual(["INSERT INTO t VALUES ('a;b')", '-- comentario; com ponto e virgula\nSELECT 1']);
  });

  it('pula GRANT e FLUSH (em producao tudo roda como usr_samu), e conta o que pulou', () => {
    const r = separarInstrucoes("GRANT SELECT ON x TO 'y'@'%';\nSELECT 1;\nFLUSH PRIVILEGES;");
    expect(r.instrucoes).toEqual(['SELECT 1']);
    expect(r.puladas).toHaveLength(2);
  });

  it('separa os arquivos reais de db/ nas rotinas certas', () => {
    const db10 = readFileSync(resolve(__dirname, '../../db/10_valor_tipado_e_historico.sql'), 'utf8');
    const r = separarInstrucoes(db10);
    expect(r.instrucoes.filter((s) => s.startsWith('CREATE PROCEDURE'))).toHaveLength(1);
    expect(r.puladas).toEqual([expect.stringMatching(/^GRANT EXECUTE/)]);
  });
});
