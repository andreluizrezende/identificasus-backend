// Aplica um arquivo de db/ no banco apontado por DB_PROD. Chamado por
// aplicar-migracao-producao.ps1, que monta DB_PROD e passa o arquivo.
//
// (!) OS GRANTS SAO PULADOS. Em producao (CloudClusters) os usuarios nri_* do
//     ADR-14 nao existem e o usr_samu nao pode criar nem dar GRANT: tudo roda
//     como usr_samu (ver PENDENCIAS.md). O script lista o que pulou.
//
// (!) ENTENDE DELIMITER, como o cliente mysql. Procedure e gatilho com
//     BEGIN ... END tem ";" por dentro; o arquivo troca o delimitador
//     (DELIMITER //) e o script separa as instrucoes por ele, mandando uma de
//     cada vez. Antes o script recusava esses arquivos, e procedure so mudava
//     em producao a mao.
//
// (!) Arquivo a parte, e nao `node -e`: o PowerShell 5.1 tira as aspas duplas
//     dos argumentos passados a programas externos.
const fs = require('fs');
const path = require('path');

/**
 * Separa o texto de um arquivo .sql em instrucoes, como o cliente mysql:
 * respeita DELIMITER, ignora linhas de comentario "--" fora de instrucao, e
 * nao corta dentro de aspas. Devolve as instrucoes e as que foram puladas
 * (GRANT/FLUSH, que em producao o usr_samu nao pode executar).
 */
function separarInstrucoes(texto, { pularGrants = true } = {}) {
  const instrucoes = [];
  const puladas = [];
  let delimitador = ';';
  let atual = '';

  const fechar = () => {
    const sql = atual.trim();
    atual = '';
    if (!sql) return;
    if (pularGrants && /^(GRANT|FLUSH)\b/i.test(sql)) puladas.push(sql.split('\n')[0]);
    else instrucoes.push(sql);
  };

  for (const linha of texto.replace(/\r\n/g, '\n').split('\n')) {
    const troca = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(linha);
    if (troca) {
      fechar();
      delimitador = troca[1];
      continue;
    }
    if (!atual.trim() && /^\s*(--|#)/.test(linha)) continue;

    let resto = linha;
    for (;;) {
      const i = posicaoForaDeAspas(resto, delimitador);
      if (i < 0) break;
      atual += resto.slice(0, i);
      fechar();
      resto = resto.slice(i + delimitador.length);
    }
    atual += `${resto}\n`;
  }
  fechar();
  return { instrucoes, puladas };
}

/** Posicao do delimitador fora de aspas simples, duplas ou crases; -1 se nao houver. */
function posicaoForaDeAspas(linha, delimitador) {
  let aspa = null;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (aspa) {
      if (c === '\\') { i += 1; continue; }
      if (c === aspa) aspa = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { aspa = c; continue; }
    if (c === '-' && linha[i + 1] === '-') return -1; // comentario ate o fim da linha
    if (linha.startsWith(delimitador, i)) return i;
  }
  return -1;
}

module.exports = { separarInstrucoes };

if (require.main === module) {
  const m = require('mysql2/promise');
  const arquivo = process.argv[2];
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.log('Uso: node aplicar-migracao.cjs db/NN_nome.sql');
    process.exit(1);
  }
  const { instrucoes, puladas } = separarInstrucoes(fs.readFileSync(arquivo, 'utf8'));

  (async () => {
    const c = await m.createConnection({ uri: process.env.DB_PROD });
    try {
      for (const sql of instrucoes) await c.query(sql);
      console.log(`OK: ${path.basename(arquivo)} aplicado (${instrucoes.length} instrucoes).`);
      for (const p of puladas) console.log(`  pulado: ${p}`);
    } finally {
      await c.end();
    }
  })().catch((e) => {
    console.log(`ERRO: ${e.code} - ${e.sqlMessage || e.message}`);
    process.exit(1);
  });
}
