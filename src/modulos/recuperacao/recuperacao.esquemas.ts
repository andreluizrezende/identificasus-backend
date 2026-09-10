import { z } from 'zod';

/** O servidor exige 8; a tela exige o mesmo para nao gastar uma ida ate aqui. */
export const SENHA_MINIMA = 8;
export const DIGITOS_DO_CODIGO = 6;
export const MINUTOS_DE_VALIDADE = 15;

/**
 * Seis digitos sao um milhao de combinacoes — nada, para um script. O que torna
 * o codigo curto seguro e o teto de tentativas: cinco palpites errados queimam
 * o codigo, e ai e preciso pedir outro, que passa pela caixa de e-mail.
 */
export const TENTATIVAS_POR_CODIGO = 5;

/**
 * Freio de pedidos, por e-mail. Existe contra duas coisas: encher a caixa de
 * alguem, e usar o tempo de resposta para descobrir quais contas existem.
 */
export const PEDIDOS_POR_JANELA = 3;
export const JANELA_DE_PEDIDOS_MS = 15 * 60 * 1000;

const email = z.string().trim().toLowerCase().email().max(180);

export const esquemaPedido = z.object({ ds_email: email });
export type Pedido = z.infer<typeof esquemaPedido>;

export const esquemaConfirmacao = z.object({
  ds_email: email,
  co_codigo: z.string().trim().regex(/^\d{6}$/),
  nova_senha: z.string().min(SENHA_MINIMA).max(200),
});
export type Confirmacao = z.infer<typeof esquemaConfirmacao>;

export interface RespostaRecuperacao {
  sucesso: boolean;
  mensagem: string;
  acao: string;
}

/**
 * (!) A RESPOSTA DO PASSO 1 E SEMPRE ESTA. Conta inexistente, conta inativa e
 *     conta real recebem o mesmo 200 e o mesmo texto. Distinguir os casos
 *     entrega a quem tenta a lista de quem trabalha aqui.
 */
export const RESPOSTA_NEUTRA: RespostaRecuperacao = {
  sucesso: true,
  mensagem: 'Se este e-mail estiver cadastrado, o codigo chegou na caixa de entrada',
  acao: `O codigo tem ${DIGITOS_DO_CODIGO} digitos e vale por ${MINUTOS_DE_VALIDADE} minutos`,
};
