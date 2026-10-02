import { NotFoundException } from '@nestjs/common';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdministracaoService } from '@/modulos/administracao/administracao.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { URL_ADMINISTRACAO_TESTE, acessoDeTeste, conexao, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

/**
 * Cadastro pela tela (US-34) contra o banco de verdade.
 *
 * (!) O SERVIÇO RODA COMO nri_administracao, com os grants reais (db/02 e
 *     db/12). O SQL do cadastro e os grants que ele precisa são conferidos
 *     aqui, e não no primeiro uso em produção.
 *
 * Trocar perfis apaga linhas de mob_usuario_perfil, e o DELETE vem de db/12:
 * sem ele aplicado neste banco (`npm run db:cadastro`), esse teste é pulado e
 * diz por quê.
 */
let acesso: BancoPorFinalidade;
let cen: Cenario;
let servico: AdministracaoService;
let temDeleteDePerfil = false;
const criados: number[] = [];

/** CPF com dígitos verificadores válidos, na faixa 000 (não emitida pela Receita). */
function cpfValidoDeTeste(): string {
  const base = `000${String(Date.now() % 1_000_000).padStart(6, '0')}`;
  const dv = (s: string): number => {
    let soma = 0;
    for (let i = 0; i < s.length; i += 1) soma += Number(s[i]) * (s.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(base + d1)}`;
}

beforeAll(async () => {
  acesso = acessoDeTeste();
  cen = await montarCenario('adm');
  servico = new AdministracaoService(acesso, new AuditoriaService(acesso));
  const c = await createConnection({ uri: URL_ADMINISTRACAO_TESTE });
  try {
    const [g] = await c.query<RowDataPacket[]>('SHOW GRANTS');
    temDeleteDePerfil = g.some((l) => /DELETE.*mob_usuario_perfil/.test(String(Object.values(l)[0])));
  } finally {
    await c.end();
  }
});

afterAll(async () => {
  const c = await conexao();
  try {
    if (criados.length > 0) await c.query("UPDATE mob_usuario SET st_ativo = 'I' WHERE id_usuario IN (?)", [criados]);
  } finally {
    await c.end();
  }
  await limparCenario(cen);
  await acesso.onModuleDestroy();
});

describe('cadastro pela tela, no banco', () => {
  it('referências trazem a base do cenário e os perfis', async () => {
    const r = await servico.referencias();
    expect(r.bases.some((b) => b.codigo === `T-${cen.sufixo}` && b.ativa)).toBe(true);
    expect(r.perfis.map((p) => p.codigo)).toEqual(expect.arrayContaining(['CAMPO', 'REGULACAO']));
  });

  it('(!) cria profissional sem senha, aparece mascarado e "aguardando primeiro acesso", e desativa', async () => {
    const cpf = cpfValidoDeTeste();
    const { id } = await servico.criarProfissional({
      nome: `Profissional adm ${cen.sufixo}`, cpf, email: `adm-${cen.sufixo}@teste.local`,
      cargo: null, conselho: null, finalidade: 'ASSISTENCIAL', perfis: ['CAMPO'],
    }, cen.idUsuarioA);
    criados.push(id);

    const p = (await servico.profissionais()).find((x) => x.id === id);
    expect(p).toMatchObject({ cpf: `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`, perfis: ['CAMPO'], ativo: true, temSenha: false });

    const c = await conexao();
    try {
      const [[linha]] = await c.query<RowDataPacket[]>('SELECT ds_senha_hash FROM mob_usuario WHERE id_usuario = ?', [id]);
      expect(linha?.ds_senha_hash).toBeNull();
      const [trilha] = await c.query<RowDataPacket[]>(
        "SELECT ds_detalhe FROM mob_auditoria WHERE co_acao = 'admin_profissional_criado' AND id_usuario = ? ORDER BY id_auditoria DESC LIMIT 1",
        [cen.idUsuarioA],
      );
      expect(JSON.stringify(trilha[0]?.ds_detalhe)).not.toContain(cpf);
    } finally {
      await c.end();
    }

    await servico.alterarProfissional(id, { ativo: false }, cen.idUsuarioA);
    expect((await servico.profissionais()).find((x) => x.id === id)?.ativo).toBe(false);
  });

  // Pulado sem db/12 neste banco: rode `npm run db:cadastro` como root do MySQL.
  it('trocar perfis (precisa do DELETE de db/12)', async (ctx) => {
    if (!temDeleteDePerfil) ctx.skip();
    const { id } = await servico.criarProfissional({
      nome: `Perfis adm ${cen.sufixo}`, cpf: cpfValidoDeTeste(), email: `perfis-${cen.sufixo}@teste.local`,
      cargo: null, conselho: null, finalidade: 'ASSISTENCIAL', perfis: ['CAMPO'],
    }, cen.idUsuarioA);
    criados.push(id);
    await servico.alterarProfissional(id, { perfis: ['SUPERVISAO'], finalidade: 'ADJUDICACAO' }, cen.idUsuarioA);
    expect((await servico.profissionais()).find((x) => x.id === id)).toMatchObject({ perfis: ['SUPERVISAO'], finalidade: 'ADJUDICACAO' });
  });

  it('(!) autoriza um aparelho na base e revoga uma vez só', async () => {
    const codigo = `TAB-${cen.sufixo}`.toUpperCase().slice(0, 30);
    await servico.cadastrarAparelho({ codigo, base: `T-${cen.sufixo}`.toUpperCase(), modelo: 'Tablet de teste' }, cen.idUsuarioA);
    expect((await servico.aparelhos()).find((a) => a.codigo === codigo)).toMatchObject({ ativo: true, revogadoEm: null });

    await servico.revogarAparelho(codigo, { motivo: 'Teste de revogação no banco.' }, cen.idUsuarioA);
    const revogado = (await servico.aparelhos()).find((a) => a.codigo === codigo);
    expect(revogado?.ativo).toBe(false);
    expect(revogado?.revogadoEm).not.toBeNull();
    await expect(servico.revogarAparelho(codigo, { motivo: 'De novo, por engano.' }, cen.idUsuarioA))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
