import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cifrarSenha } from '@/acesso/senha';
import { TokenService } from '@/acesso/token.service';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { Credencial } from '@/modulos/recuperacao/credencial.service';
import { SessaoEncerrada, SessaoService } from '@/modulos/sessao/sessao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import { acessoDeTeste, conexao, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

/**
 * Entrada e renovação contra o banco de verdade.
 *
 * (!) O QUE SÓ O BANCO PROVA: a renovação lê `mob_sessao` e `mob_usuario` como
 *     `nri_assistencial`, com os grants reais. Um grant faltando, uma coluna
 *     de data gravada num fuso e comparada em outro (`st_expiracao` em UTC
 *     contra `UTC_TIMESTAMP`), ou o UPDATE do "sair" que não pega — nada disso
 *     aparece num teste de unidade com o banco simulado.
 */
const SENHA = 'senha-de-teste-do-banco';

let acesso: BancoPorFinalidade;
let cen: Cenario;
let sessao: SessaoService;
let email: string;
let coDispositivo: string;

beforeAll(async () => {
  process.env.JWT_SEGREDO ??= 'segredo-de-teste-do-banco-com-mais-de-32-bytes';
  cen = await montarCenario('sessao');
  email = `a-${cen.sufixo}@teste.local`;
  coDispositivo = `D-${cen.sufixo}`;
  acesso = acessoDeTeste();
  sessao = new SessaoService(acesso, new TokenService(), new AuditoriaService(acesso));

  // A senha entra pela conexão de montagem: o cenário nasce sem senha.
  const c = await conexao();
  try {
    await c.query('UPDATE mob_usuario SET ds_senha_hash = ? WHERE id_usuario = ?', [
      await cifrarSenha(SENHA), cen.idUsuarioA,
    ]);
  } finally {
    await c.end();
  }
});

afterAll(async () => {
  await limparCenario(cen);
  await acesso.onModuleDestroy();
});

async function entrar() {
  return sessao.entrar({ ds_email: email, senha: SENHA, coDispositivo }, '127.0.0.1');
}

describe('renovação do token contra o banco', () => {
  it('sessão viva troca o token de renovação por um token de acesso novo', async () => {
    const aberta = await entrar();
    const renovada = await sessao.renovar(aberta.renovacao);
    expect(renovada.expiraEmSegundos).toBe(900);

    // O token novo é aceito pelo mesmo serviço que o guard usa.
    const portador = await new TokenService().verificar(renovada.token);
    expect(portador.sub).toBe(String(cen.idUsuarioA));
    expect(portador.purpose).toBe('ASSISTENCIAL');
  });

  it('depois do "sair", a renovação é recusada', async () => {
    const aberta = await entrar();
    await sessao.sair(cen.idUsuarioA, aberta.coSessao);
    await expect(sessao.renovar(aberta.renovacao)).rejects.toBeInstanceOf(SessaoEncerrada);
  });

  it('sessão de 72 h vencida não renova, mesmo com o token de renovação válido', async () => {
    const aberta = await entrar();
    const c = await conexao();
    try {
      await c.query(
        'UPDATE mob_sessao SET st_expiracao = UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE WHERE co_token = ?',
        [aberta.coSessao],
      );
    } finally {
      await c.end();
    }
    await expect(sessao.renovar(aberta.renovacao)).rejects.toBeInstanceOf(SessaoEncerrada);
  });

  it('troca de senha derruba a renovação das sessões abertas antes dela', async () => {
    const aberta = await entrar();
    // O carimbo de st_credenciais_alteradas tem resolução de segundo no token:
    // espera o relógio virar para a troca cair depois do login.
    await new Promise((r) => setTimeout(r, 2100));
    const troca = await new Credencial(acesso).trocarSenha(cen.idUsuarioA, email, `${SENHA}-nova`);
    expect(troca.trocada).toBe(true);

    await expect(sessao.renovar(aberta.renovacao)).rejects.toBeInstanceOf(SessaoEncerrada);
  });
});
