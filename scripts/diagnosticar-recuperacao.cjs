// Le, no banco apontado por DB_PROD, o que aconteceu com os pedidos de
// recuperacao de senha. So consulta; nao grava. Chamado por
// diagnosticar-recuperacao-producao.ps1, que monta DB_PROD.
//
// (!) Arquivo a parte, e nao `node -e`, de proposito: o PowerShell 5.1 tira as
//     aspas duplas dos argumentos passados a programas externos, e o codigo
//     chegava quebrado ao Node.
const m = require('mysql2/promise');

(async () => {
  const c = await m.createConnection({ uri: process.env.DB_PROD, dateStrings: true });
  try {
    const [u] = await c.query(
      'SELECT id_usuario, ds_email, st_ativo FROM mob_usuario ORDER BY id_usuario');
    console.log('\nUsuarios cadastrados (o e-mail digitado precisa ser exatamente um destes):');
    console.table(u);

    const [r] = await c.query(
      `SELECT r.id_recuperacao, u.ds_email, r.st_criacao, r.st_expiracao, r.st_uso, r.qt_tentativas
         FROM mob_recuperacao r JOIN mob_usuario u ON u.id_usuario = r.id_usuario
        ORDER BY r.id_recuperacao DESC LIMIT 5`);
    console.log('Pedidos de codigo gravados (vazio = nenhum e-mail digitado bateu com o cadastro):');
    console.table(r);

    const [a] = await c.query(
      `SELECT st_ocorrencia, co_acao, ds_detalhe FROM mob_auditoria
        WHERE co_acao LIKE 'RECUPERACAO%' ORDER BY id_auditoria DESC LIMIT 5`);
    console.log('Trilha (RECUPERACAO_PEDIDA = servidor SMTP aceitou; RECUPERACAO_FALHOU = recusou):');
    console.table(a);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.log('ERRO: ' + e.code + ' - ' + (e.sqlMessage || e.message));
  process.exit(1);
});
