import { z } from 'zod';

/** CASO: o que o aparelho registrou ao abrir o caso, fora de linha. */
export const esquemaConteudoCaso = z.object({
  dtOcorrencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hrOcorrencia: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  coOcorrenciaSamu: z.string().trim().max(30).nullish(),
  dsLocal: z.string().trim().max(200).nullish(),
  vlLatitude: z.number().min(-90).max(90).nullish(),
  vlLongitude: z.number().min(-180).max(180).nullish(),
  nuPrecisaoGps: z.number().int().min(0).max(65535).nullish(),
  coViatura: z.string().trim().max(20).nullish(),
});

/** ATRIBUTO: um valor capturado, sempre com procedência. */
export const esquemaConteudoAtributo = z
  .object({
    coAtributo: z.string().trim().max(40),
    coProcedencia: z.enum(['OBSERVADO', 'INFORMADO', 'ESTIMADO']),
    coValor: z.string().trim().max(40).nullish(),
    dsValor: z.string().trim().max(300).nullish(),
  })
  // Procedência sem valor não é registro, é ruído; e valor sem procedência não
  // pode ser ponderado depois, o que o torna inútil para a comparação.
  .refine((c) => Boolean(c.coValor) || Boolean(c.dsValor), {
    message: 'informe coValor (vocabulário) ou dsValor (texto livre)',
  });

export const esquemaConteudoEstado = z.object({
  stAtual: z.enum(['ABERTO', 'ENRIQUECIMENTO', 'ANALISE', 'ENCERRADO']),
  dsMotivo: z.string().trim().max(300).nullish(),
});

/**
 * MÍDIA: só a referência. O binário sobe direto para o armazenamento de
 * objetos — um BLOB de foto no InnoDB inviabiliza backup e replicação já no
 * primeiro ano.
 */
export const esquemaConteudoMidia = z.object({
  tpMidia: z.enum(['IMG', 'DOC']),
  dsCaminho: z.string().trim().max(300),
  coHash: z.string().regex(/^[0-9a-f]{64}$/i, 'SHA-256 em hexadecimal'),
  nuTamanho: z.number().int().positive(),
  dsLegenda: z.string().trim().max(150).nullish(),
});

export const esquemaEventoEntrada = z.object({
  coIdempotencia: z.string().uuid(),
  tipo: z.enum(['CASO', 'ATRIBUTO', 'MIDIA', 'ESTADO']),
  coCaso: z.string().trim().min(1).max(20),
  conteudo: z.unknown(),
  capturadoEm: z.string().datetime(),
});
export type EventoEntrada = z.infer<typeof esquemaEventoEntrada>;

export const esquemaLote = z.object({
  /** Qual aparelho está enviando. Aparelho revogado não sincroniza. */
  coDispositivo: z.string().trim().min(1).max(30),
  // 200 eventos: um plantão inteiro de captura cabe num lote, e o lote inteiro
  // cabe numa requisição de rede ruim.
  eventos: z.array(esquemaEventoEntrada).min(1).max(200),
});
export type Lote = z.infer<typeof esquemaLote>;

export interface RespostaLote {
  /** O aparelho só apaga da fila local o que estiver aqui. */
  aplicados: string[];
  divergentes: Array<{
    coIdempotencia: string;
    coAtributo: string;
    valorDispositivo: string;
    valorServidor: string;
    autorServidor: string | null;
  }>;
  recusados: Array<{ coIdempotencia: string; motivo: string }>;
}
