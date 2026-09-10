import { createHash } from 'node:crypto';

export interface EloAuditoria {
  id: string;
  ocorridoEm: string;
  usuarioId: number;
  finalidade: string;
  acao: string;
  recurso: string;
  detalhe: unknown;
}

/**
 * JSON canonico: chaves ordenadas, sem espacos. Sem isto, a mesma informacao
 * produz hashes diferentes e a cadeia fica inverificavel.
 */
export function canonizar(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(canonizar).join(',')}]`;
  const entradas = Object.entries(valor as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${canonizar(v)}`).join(',')}}`;
}

export function calcularElo(anterior: string, elo: EloAuditoria): string {
  const material = [
    anterior, elo.id, elo.ocorridoEm, String(elo.usuarioId),
    elo.finalidade, elo.acao, elo.recurso, canonizar(elo.detalhe),
  ].join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

export const ELO_GENESE = '0'.repeat(64);
