export const FINALIDADES = ['ASSISTENCIAL', 'AUDITORIA', 'PESQUISA', 'ADMINISTRACAO'] as const;
export type Finalidade = (typeof FINALIDADES)[number];

export function ehFinalidade(v: unknown): v is Finalidade {
  return typeof v === 'string' && FINALIDADES.includes(v as Finalidade);
}
