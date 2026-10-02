/**
 * Número de atributo como a regulação e a equipe leem: formato brasileiro e
 * sem zeros à direita. "1.720" e "1.80" se leriam como mil e setecentos e
 * cento e oitenta; saem "1,72" e "1,8".
 *
 * Texto que não é número volta como veio: o valor do campo nunca é perdido
 * por causa da formatação.
 */
export function numeroLegivel(vl: string | null): string | null {
  if (vl === null) return null;
  const limpo = vl.trim();
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) return vl;
  return Number(limpo).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/**
 * O valor de um atributo como sai para a tela. Termo controlado ganha do texto,
 * que ganha do número, que ganha da data (só uma coluna é preenchida por vez).
 *
 * (!) ATRIBUTO NUMÉRICO CHEGA COMO TEXTO. A gravação (sp_mob_registra_atributo)
 *     só recebe texto, então a estatura fica em `ds_valor` ("1.80") e não em
 *     `vl_numerico`. Para `tp_dado = 'N'`, o texto também é formatado.
 */
export function valorDoAtributo(l: {
  tp_dado?: string | null;
  no_termo: string | null;
  ds_valor: string | null;
  vl_numerico: string | null;
  dt_valor: string | null;
}): string | null {
  if (l.no_termo !== null) return l.no_termo;
  if (l.ds_valor !== null) return l.tp_dado === 'N' ? numeroLegivel(l.ds_valor) : l.ds_valor;
  return numeroLegivel(l.vl_numerico) ?? l.dt_valor;
}
