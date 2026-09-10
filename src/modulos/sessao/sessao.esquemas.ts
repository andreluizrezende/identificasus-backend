import { z } from 'zod';

/**
 * (!) `senha` NÃO TEM `.trim()`. Espaço em branco no início ou no fim é parte
 *     legítima de uma senha, e cortá-lo em silêncio faz a pessoa entrar hoje e
 *     não entrar amanhã, num aparelho cujo teclado insere espaço depois do
 *     preenchimento automático. E-mail e código de aparelho, sim, são
 *     normalizados: ali o espaço nunca é significativo.
 */
export const esquemaEntrada = z.object({
  ds_email: z.string().trim().toLowerCase().email(),
  senha: z.string().min(1),
  coDispositivo: z.string().trim().min(1).max(30),
});
export type Entrada = z.infer<typeof esquemaEntrada>;

export const esquemaSaida = z.object({
  coSessao: z.string().uuid(),
  ds_motivo: z.string().trim().max(120).optional(),
});
export type Saida = z.infer<typeof esquemaSaida>;

export interface SessaoAberta {
  /** Token de acesso do Keycloak. Vale 15 minutos. */
  token: string;
  /** Token de renovação. É ele que sustenta as 72 h fora de linha. */
  renovacao: string;
  expiraEmSegundos: number;
  /** Identificador local da sessão; volta no encerramento e no expurgo. */
  coSessao: string;
  /** Instante em que a sessão offline caduca, em ISO-8601. */
  st_expiracao: string;
  usuario: {
    id: number;
    no_usuario: string;
    ds_email: string | null;
    perfis: string[];
  };
  dispositivo: {
    co_dispositivo: string;
    id_base: number;
    no_base: string;
  };
}
