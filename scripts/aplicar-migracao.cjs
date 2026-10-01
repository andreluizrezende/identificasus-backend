// Aplica um arquivo de db/ no banco apontado por DB_PROD. Chamado por
// aplicar-migracao-producao.ps1, que monta DB_PROD e passa o arquivo.
//
// (!) OS GRANTS SAO PULADOS. Em producao (CloudClusters) os usuarios nri_* do
//     ADR-14 nao existem e o usr_samu nao pode criar nem dar GRANT: tudo roda
//     como usr_samu (ver PENDENCIAS.md). O script lista o que pulou.
//
// (!) Arquivo a parte, e nao `node -e`: o PowerShell 5.1 tira as aspas duplas
//     dos argumentos passados a programas externos.
const fs = require('fs');
const path = require('path');
const m = require('mysql2/promise');

const arquivo = process.argv[2];
if (!arquivo || !fs.existsSync(arquivo)) {
  console.log('Uso: node aplicar-migracao.cjs db/NN_nome.sql');
  process.exit(1);
}
if (/^\s*DELIMITER\b/im.test(fs.readFileSync(arquivo, 'utf8'))) {
  console.log('Este arquivo usa DELIMITER (procedure/gatilho); aplique com o cliente mysql.');
  process.exit(1);
}

const pulados = [];
const sql = fs.readFileSync(arquivo, 'utf8').replace(/^\s*(GRANT|FLUSH)\b[\s\S]*?;[ \t]*$/gm, (s) => {
  pulados.push(s.trim().split('\n')[0]);
  return '';
});

(async () => {
  const c = await m.createConnection({ uri: process.env.DB_PROD, multipleStatements: true });
  try {
    await c.query(sql);
    console.log(`OK: ${path.basename(arquivo)} aplicado.`);
    for (const p of pulados) console.log(`  pulado: ${p}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.log(`ERRO: ${e.code} - ${e.sqlMessage || e.message}`);
  process.exit(1);
});
