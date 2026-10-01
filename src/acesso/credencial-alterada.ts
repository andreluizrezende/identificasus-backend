/**
 * A senha foi trocada depois da emissão deste token?
 *
 * Usada pelo guard (token de acesso) e pela renovação (token de renovação): é
 * o que faz a troca de senha derrubar as sessões abertas com a senha velha. Se
 * só o guard conferisse, um token de renovação antigo continuaria fabricando
 * tokens de acesso novos depois da troca.
 *
 * O pool abre com `dateStrings: true`, então a coluna chega como texto do
 * MySQL (`YYYY-MM-DD HH:MM:SS.ffffff`) — em UTC, que é como o pool escreve.
 * O `Z` no fim é o que impede o Node de reinterpretar isso no fuso da
 * máquina e deslocar a comparação em três horas.
 */
export function credencialMudouDepoisDoToken(coluna: string | null, emitidoEm: number): boolean {
  if (!coluna) return false;
  const alteradaEm = Date.parse(`${coluna.replace(' ', 'T')}Z`);
  if (Number.isNaN(alteradaEm)) return false;
  // Um segundo de folga: `iat` tem resolução de segundo e a coluna, de
  // microssegundo. Sem a folga, um token emitido no mesmo segundo da troca
  // seria derrubado por arredondamento.
  return Math.floor(alteradaEm / 1000) > emitidoEm + 1;
}
