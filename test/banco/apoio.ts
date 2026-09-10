/**
 * Apoio dos testes que falam com o MySQL de verdade.
 *
 * (!) BANCO REAL, E NÃO DUBLÊ. As três invariantes que estes testes cobrem —
 *     idempotência, versionamento e completude — moram em constraints,
 *     procedure e coluna gerada. Um dublê de banco passaria em todos e não
 *     provaria nada: seria o teste conferindo a própria expectativa.
 *
 * (!) RODA CONTRA `dbsamu` E APAGA O QUE CRIA. Cada teste trabalha com um
 *     sufixo próprio e limpa no fim, na ordem inversa das chaves estrangeiras.
 *     Não aponte `DATABASE_URL_TESTE` para um banco com dado de gente.
 */

import { createConnection } from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { ConfigService } from '@nestjs/config';

/**
 * DUAS URLs, E ISSO É PARTE DO TESTE.
 *
 * Os serviços rodam como `nri_assistencial`, com os grants reais do ADR-14 —
 * então um teste que passe aqui prova também que os grants bastam para o
 * caminho exercitado. Uma tabela esquecida no GRANT aparece como falha de
 * teste, e não como erro em produção às três da manhã.
 *
 * O cenário (base, viatura, aparelho, profissionais) é montado e desmontado
 * como `nri_migracao`, que é quem tem DDL e DML amplos. `nri_assistencial` não
 * consegue criar um usuário nem uma base, e é assim que tem de ser.
 */
export const URL_TESTE =
  process.env.DATABASE_URL_TESTE ??
  'mysql://nri_assistencial:trocar@127.0.0.1:3306/dbsamu';

export const URL_AUDITORIA_TESTE =
  process.env.DATABASE_URL_AUDITORIA_TESTE ??
  'mysql://nri_auditoria:trocar@127.0.0.1:3306/dbsamu';

/** Só para montar e desmontar cenário. Nunca usada por um serviço. */
export const URL_ADMIN_TESTE =
  process.env.DATABASE_URL_ADMIN_TESTE ??
  'mysql://nri_migracao:trocar@127.0.0.1:3306/dbsamu';

/** ConfigService mínimo: os testes não sobem o contêiner de injeção do Nest. */
export function acessoDeTeste(): BancoPorFinalidade {
  const config = {
    get: (chave: string): string | undefined => {
      if (chave === 'DATABASE_URL_AUDITORIA') return URL_AUDITORIA_TESTE;
      if (chave === 'DATABASE_URL_PESQUISA') return URL_AUDITORIA_TESTE;
      if (chave.startsWith('DATABASE_URL')) return URL_TESTE;
      return process.env[chave];
    },
  } as unknown as ConfigService;
  return new BancoPorFinalidade(config);
}

/** Conexão de inspeção e de montagem de cenário: privilégios amplos. */
export async function conexao(): Promise<Connection> {
  return createConnection({ uri: URL_ADMIN_TESTE, dateStrings: true, timezone: 'Z' });
}

export interface Cenario {
  idBase: number;
  idViatura: number;
  idDispositivo: number;
  idUsuarioA: number;
  idUsuarioB: number;
  sufixo: string;
}

/**
 * Monta base, viatura, aparelho e dois profissionais. Dois, e não um: metade
 * do que se testa aqui só existe quando duas pessoas tocam o mesmo caso.
 */
export async function montarCenario(rotulo: string): Promise<Cenario> {
  const c = await conexao();
  const sufixo = `${rotulo}-${Date.now().toString(36)}`;
  try {
    const [base] = await c.query<RowDataPacket[] & { insertId: number }>(
      `INSERT INTO mob_base (co_base, no_base, sg_base, st_ativo) VALUES (?, ?, 'TST', 'A')`,
      [`T-${sufixo}`, `Base de teste ${sufixo}`],
    );
    const idBase = (base as unknown as { insertId: number }).insertId;

    const [viatura] = await c.query(
      `INSERT INTO mob_viatura (id_base, co_viatura, tp_viatura, st_ativo) VALUES (?, ?, 'USB', 'A')`,
      [idBase, `V-${sufixo}`],
    );
    const [dispositivo] = await c.query(
      `INSERT INTO mob_dispositivo (id_base, co_dispositivo, ds_modelo, st_ativo)
       VALUES (?, ?, 'aparelho de teste', 'A')`,
      [idBase, `D-${sufixo}`],
    );
    const [a] = await c.query(
      `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, co_usuario_idp, st_ativo)
       VALUES (?, ?, ?, ?, 'A')`,
      [cpfDeTeste(), `Profissional A ${sufixo}`, `a-${sufixo}@teste.local`, `idp-a-${sufixo}`],
    );
    const [b] = await c.query(
      `INSERT INTO mob_usuario (nu_cpf, no_usuario, ds_email, co_usuario_idp, st_ativo)
       VALUES (?, ?, ?, ?, 'A')`,
      [cpfDeTeste(), `Profissional B ${sufixo}`, `b-${sufixo}@teste.local`, `idp-b-${sufixo}`],
    );

    return {
      idBase,
      idViatura: id(viatura),
      idDispositivo: id(dispositivo),
      idUsuarioA: id(a),
      idUsuarioB: id(b),
      sufixo,
    };
  } finally {
    await c.end();
  }
}

/**
 * Desmonta o cenário — e a forma como ele NÃO desmonta é o achado mais
 * interessante destes testes.
 *
 * (!) BASE, APARELHO E PROFISSIONAL NÃO SÃO APAGADOS, PORQUE NÃO PODEM SER.
 *     `mob_auditoria` tem chave estrangeira para os três, e dois gatilhos
 *     bloqueiam UPDATE e DELETE nela. Assim que um evento é registrado, as
 *     entidades que ele menciona ficam presas pela trilha: apagá-las
 *     transformaria um elo em referência para o nada.
 *
 *     Isso não é um obstáculo do teste, é a propriedade que a trilha existe
 *     para ter — e o teste descobriu isso do jeito certo, tentando apagar e
 *     esbarrando no banco. Em produção a mesma regra vale, e é ela que impede
 *     "desligar" um aparelho apagando a linha dele.
 *
 *     Então o que sobra é o que a operação real faria: desativar. Caso,
 *     atributo, evento e turno saem — nada disso é referenciado pela trilha
 *     por chave estrangeira. Base, viatura, aparelho e usuário ficam inativos.
 */
export async function limparCenario(cen: Cenario): Promise<void> {
  const c = await conexao();
  const usuarios = [cen.idUsuarioA, cen.idUsuarioB];
  try {
    const [casos] = await c.query<RowDataPacket[]>(
      'SELECT id_caso FROM mob_caso WHERE id_base = ?', [cen.idBase],
    );
    const ids = casos.map((l) => Number((l as { id_caso: number }).id_caso));

    for (const tabela of ['mob_divergencia', 'mob_midia', 'mob_caso_atributo', 'mob_caso_estado']) {
      if (ids.length > 0) await c.query(`DELETE FROM ${tabela} WHERE id_caso IN (?)`, [ids]);
    }
    await c.query('DELETE FROM mob_evento_sincronizacao WHERE id_dispositivo = ?', [cen.idDispositivo]);
    if (ids.length > 0) await c.query('DELETE FROM mob_caso WHERE id_caso IN (?)', [ids]);
    await c.query('DELETE FROM mob_turno_guarnicao WHERE id_usuario IN (?)', [usuarios]);
    await c.query('DELETE FROM mob_turno WHERE id_usuario IN (?)', [usuarios]);
    await c.query('DELETE FROM mob_sessao WHERE id_usuario IN (?)', [usuarios]);
    await c.query('DELETE FROM mob_recuperacao WHERE id_usuario IN (?)', [usuarios]);
    // Daqui para baixo: desativar, nunca apagar. Ver o comentário da função.
    await c.query(
      "UPDATE mob_usuario SET st_ativo = 'I' WHERE id_usuario IN (?)", [usuarios],
    );
    await c.query(
      `UPDATE mob_dispositivo SET st_ativo = 'I', st_revogacao = CURRENT_TIMESTAMP(6)
        WHERE id_dispositivo = ?`, [cen.idDispositivo],
    );
    await c.query("UPDATE mob_viatura SET st_ativo = 'I' WHERE id_viatura = ?", [cen.idViatura]);
    await c.query("UPDATE mob_base SET st_ativo = 'I' WHERE id_base = ?", [cen.idBase]);
  } finally {
    await c.end();
  }
}

let sequencia = 0;
function cpfDeTeste(): string {
  // Faixa que a Receita não emite; e o dígito verificador não é validado pelo
  // banco, só o formato. Serve para teste e não colide com pessoa real.
  sequencia += 1;
  return `000${String(Date.now() % 100000).padStart(5, '0')}${String(sequencia).padStart(3, '0')}`.slice(0, 11);
}

function id(resultado: unknown): number {
  return (resultado as { insertId: number }).insertId;
}
