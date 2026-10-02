import { hkdfSync } from 'node:crypto';

/**
 * Chave da fila local do aparelho de campo: uma por pessoa, por aparelho, e a
 * mesma em todo login.
 *
 * (!) POR QUE O SERVIDOR DERIVA E NAO O APARELHO. A fila era cifrada com uma
 *     chave tirada da senha e do coSessao, que muda a cada entrada. Qualquer
 *     coisa que mudasse a sessao (as 72 h vencendo sem rede, a troca de senha,
 *     outro login no mesmo tablet) deixava o que nao tinha subido ilegivel
 *     para sempre, e o registro do atendimento se perdia. Decisao do produto:
 *     o que foi capturado fica guardado ate haver rede. Uma chave estavel por
 *     pessoa e aparelho cumpre isso, e so o servidor pode entrega-la de novo
 *     depois de uma troca de senha.
 *
 * (!) POR PESSOA, E NAO POR APARELHO. Na troca de plantao, quem entra nao le
 *     nem envia a fila de quem saiu: o lote e aplicado com a identidade do
 *     token, e enviar o registro de um colega com o proprio login trocaria o
 *     autor (RF-10.01). A fila de cada um sobe quando o autor entra com rede.
 *
 * (!) HKDF SOBRE O JWT_SEGREDO, COM ROTULO PROPRIO. Separa os dois usos sem
 *     exigir uma variavel de ambiente nova. O preco: trocar o JWT_SEGREDO
 *     deixa ilegivel o que estiver parado nas filas naquele momento. Rode a
 *     troca com as filas vazias.
 *
 * O aparelho nunca guarda esta chave em claro: ela fica embrulhada com uma
 * chave tirada da senha (ver `dados/cripto.ts` no app). Quem rouba o tablet
 * sem a senha nao le a fila; o servidor, que recebe esses dados de qualquer
 * jeito, nao ganha acesso a nada que ja nao tivesse.
 */
export function chaveDaFila(idUsuario: number, coDispositivo: string): string {
  const segredo = process.env.JWT_SEGREDO;
  if (!segredo) throw new Error('JWT_SEGREDO ausente: sem ele nao ha chave da fila');
  const bytes = hkdfSync(
    'sha256',
    segredo,
    'identificasus/fila-local',
    `v1:${idUsuario}:${coDispositivo}`,
    32,
  );
  return Buffer.from(bytes).toString('base64');
}
