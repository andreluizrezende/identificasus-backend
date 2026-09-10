import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { AuditoriaService } from '@/modulos/auditoria/auditoria.service';
import { CodigoRecusado, RecuperacaoService } from '@/modulos/recuperacao/recuperacao.service';
import type { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';
import type { Correio } from '@/comum/correio';
import type { Credencial } from '@/modulos/recuperacao/credencial.service';
import { acessoDeTeste, conexao, limparCenario, montarCenario } from './apoio';
import type { Cenario } from './apoio';

/**
 * A recuperação de senha contra o banco de verdade.
 *
 * (!) O KEYCLOAK É O ÚNICO DUBLÊ AQUI, e por um motivo estreito: ele não roda
 *     nesta máquina. Tudo o mais — código de uso único, teto de tentativas,
 *     `st_credenciais_alteradas` — mora no MySQL e é exercitado nele. O dublê
 *     registra o que recebeu, para que o teste possa afirmar que a senha nova
 *     chegou ao dono da credencial e não a uma coluna do `dbsamu`.
 */
class CorreioDeTeste {
  ultimoTexto = '';
  configurado(): boolean { return true; }
  async enviar(m: { texto: string }): Promise<{ entregue: boolean; motivo?: string }> {
    this.ultimoTexto = m.texto;
    return await Promise.resolve({ entregue: true });
  }
  /** O código de 6 dígitos que saiu no e-mail. Só o teste lê isto. */
  get codigo(): string {
    return /\b(\d{6})\b/.exec(this.ultimoTexto)?.[1] ?? '';
  }
}

class CredencialDeTeste {
  chamadas: Array<{ sub: string; senha: string }> = [];
  configurado(): boolean { return true; }
  async trocarSenha(sub: string, senha: string): Promise<{ trocada: true }> {
    this.chamadas.push({ sub, senha });
    return await Promise.resolve({ trocada: true });
  }
}

let acesso: BancoPorFinalidade;
let cen: Cenario;
let correio: CorreioDeTeste;
let credencial: CredencialDeTeste;
let email: string;

/**
 * (!) UM SERVIÇO NOVO POR TESTE, DE PROPÓSITO. O freio de pedidos (3 por
 *     e-mail a cada 15 minutos) vive na memória da instância — é o que o
 *     próprio código diz sobre si: serve para o caso comum, não é controle de
 *     segurança. O controle que não depende de memória é o teto de tentativas
 *     por código, que mora no banco, e é ele que os testes abaixo exercitam.
 *     Reaproveitar a instância faria o freio derrubar o quarto teste e mascarar
 *     tudo o que vem depois.
 */
function novoServico(): RecuperacaoService {
  return new RecuperacaoService(
    acesso,
    correio as unknown as Correio,
    credencial as unknown as Credencial,
    new AuditoriaService(acesso),
  );
}

beforeAll(async () => {
  cen = await montarCenario('recup');
  email = `a-${cen.sufixo}@teste.local`;
  acesso = acessoDeTeste();
  correio = new CorreioDeTeste();
  credencial = new CredencialDeTeste();
});

afterAll(async () => {
  await limparCenario(cen);
  await acesso.onModuleDestroy();
});

async function tentativasDoUltimoPedido(): Promise<number> {
  const c = await conexao();
  try {
    const [linhas] = await c.query<RowDataPacket[]>(
      `SELECT qt_tentativas FROM mob_recuperacao
        WHERE id_usuario = ? ORDER BY id_recuperacao DESC LIMIT 1`,
      [cen.idUsuarioA],
    );
    return Number((linhas[0] as { qt_tentativas: number } | undefined)?.qt_tentativas ?? -1);
  } finally {
    await c.end();
  }
}

describe('recuperação de senha contra o banco', () => {
  it('e-mail desconhecido recebe a mesma resposta de e-mail cadastrado', async () => {
    const servico = novoServico();
    const conhecido = await servico.pedirCodigo({ ds_email: email }, '127.0.0.1');
    const desconhecido = await servico.pedirCodigo(
      { ds_email: `nao-existe-${cen.sufixo}@teste.local` }, '127.0.0.1',
    );
    // Byte a byte igual: distinguir os dois entrega a lista de quem trabalha aqui.
    expect(desconhecido).toEqual(conhecido);

    const c = await conexao();
    try {
      const [linhas] = await c.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM mob_recuperacao WHERE id_usuario = ?', [cen.idUsuarioB],
      );
      // E nada foi gravado para quem não pediu.
      expect(Number((linhas[0] as { n: number }).n)).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('o código nunca é guardado em claro', async () => {
    const servico = novoServico();
    await servico.pedirCodigo({ ds_email: email }, '127.0.0.1');
    const codigo = correio.codigo;
    expect(codigo).toMatch(/^\d{6}$/);

    const c = await conexao();
    try {
      const [linhas] = await c.query<RowDataPacket[]>(
        `SELECT co_codigo_hash FROM mob_recuperacao
          WHERE id_usuario = ? ORDER BY id_recuperacao DESC LIMIT 1`,
        [cen.idUsuarioA],
      );
      const guardado = (linhas[0] as { co_codigo_hash: string }).co_codigo_hash;
      expect(guardado).not.toContain(codigo);
      expect(guardado.startsWith('$2')).toBe(true); // bcrypt
    } finally {
      await c.end();
    }
  });

  it('o código serve uma vez só, e a troca vai para o Keycloak', async () => {
    const servico = novoServico();
    await servico.pedirCodigo({ ds_email: email }, '127.0.0.1');
    const codigo = correio.codigo;

    const r = await servico.confirmar({
      ds_email: email, co_codigo: codigo, nova_senha: 'senha-nova-de-teste',
    });
    expect(r.sucesso).toBe(true);

    // A senha nova foi para o dono da credencial, e não para uma coluna daqui.
    expect(credencial.chamadas.at(-1)?.senha).toBe('senha-nova-de-teste');
    const c = await conexao();
    try {
      const [colunas] = await c.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'mob_usuario'
            AND column_name LIKE '%senha%'`,
      );
      expect(Number((colunas[0] as { n: number }).n)).toBe(0);
    } finally {
      await c.end();
    }

    // Reusar o mesmo código não funciona: st_uso já está preenchido.
    await expect(
      servico.confirmar({ ds_email: email, co_codigo: codigo, nova_senha: 'outra-senha-ainda' }),
    ).rejects.toBeInstanceOf(CodigoRecusado);
  });

  it('a troca derruba os tokens emitidos antes dela', async () => {
    const c = await conexao();
    try {
      const [linhas] = await c.query<RowDataPacket[]>(
        'SELECT st_credenciais_alteradas FROM mob_usuario WHERE id_usuario = ?', [cen.idUsuarioA],
      );
      // Sem esta coluna preenchida, quem entrou com a senha velha continuaria
      // dentro até o token expirar — o recurso pela metade, justo no caso que
      // ele existe para atender.
      expect((linhas[0] as { st_credenciais_alteradas: string | null }).st_credenciais_alteradas)
        .not.toBeNull();
    } finally {
      await c.end();
    }
  });

  it('cinco palpites errados queimam o código', async () => {
    const servico = novoServico();
    await servico.pedirCodigo({ ds_email: email }, '127.0.0.1');
    const certo = correio.codigo;
    const errado = certo === '000000' ? '999999' : '000000';

    for (let i = 0; i < 5; i += 1) {
      await expect(
        servico.confirmar({ ds_email: email, co_codigo: errado, nova_senha: 'qualquer-coisa-1' }),
      ).rejects.toBeInstanceOf(CodigoRecusado);
    }
    expect(await tentativasDoUltimoPedido()).toBe(5);

    // (!) O CÓDIGO CERTO TAMBÉM É RECUSADO DEPOIS DO TETO. Sem queimar, o teto
    //     seria só um atraso — quem estivesse adivinhando pediria outro código
    //     e continuaria de onde parou.
    await expect(
      servico.confirmar({ ds_email: email, co_codigo: certo, nova_senha: 'qualquer-coisa-2' }),
    ).rejects.toBeInstanceOf(CodigoRecusado);
  });

  it('pedir um código novo invalida o anterior', async () => {
    const servico = novoServico();
    await servico.pedirCodigo({ ds_email: email }, '127.0.0.1');
    const antigo = correio.codigo;
    await servico.pedirCodigo({ ds_email: email }, '127.0.0.1');
    const novo = correio.codigo;
    expect(novo).not.toBe(antigo);

    await expect(
      servico.confirmar({ ds_email: email, co_codigo: antigo, nova_senha: 'mais-uma-senha-1' }),
    ).rejects.toBeInstanceOf(CodigoRecusado);
  });
});

describe('cadeia de auditoria', () => {
  it('fecha do gênese ao último elo', async () => {
    const auditoria = new AuditoriaService(acesso);
    const r = await auditoria.verificarCadeia();
    expect(r.elos).toBeGreaterThan(0);
    expect(r.quebrouEm).toBeNull();
    expect(r.integra).toBe(true);
  });
});
