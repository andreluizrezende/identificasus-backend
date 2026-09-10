import { JANELA_DE_PEDIDOS_MS, PEDIDOS_POR_JANELA } from './recuperacao.esquemas';

/**
 * (!) O FREIO E DE MEMORIA DO PROCESSO, e some quando o servidor reinicia — e
 *     nao e compartilhado se um dia houver mais de uma instancia. Serve para o
 *     caso comum; nao e controle de seguranca. O controle que nao depende disto
 *     e o teto de tentativas por codigo, que mora no banco.
 */
export class FreioDePedidos {
  private readonly pedidos = new Map<string, number[]>();

  excedeu(chave: string, agora = Date.now()): boolean {
    const recentes = (this.pedidos.get(chave) ?? []).filter(
      (t) => agora - t < JANELA_DE_PEDIDOS_MS,
    );
    if (recentes.length >= PEDIDOS_POR_JANELA) {
      this.pedidos.set(chave, recentes);
      return true;
    }
    recentes.push(agora);
    this.pedidos.set(chave, recentes);
    return false;
  }

  limpar(): void {
    this.pedidos.clear();
  }
}
