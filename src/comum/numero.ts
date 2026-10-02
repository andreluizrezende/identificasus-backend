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

const NUMERO = /^-?\d+(\.\d+)?$/;
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-01" -> "01/10/2026". Texto que nao e data volta como veio. */
export function dataLegivel(dt: string | null): string | null {
  if (dt === null) return null;
  const m = DATA.exec(dt.trim().slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dt;
}

/**
 * Chave para comparar o valor que chega do aparelho com o vigente no servidor.
 *
 * (!) COMPARA O MESMO TIPO DE COISA DOS DOIS LADOS. Antes a sincronizacao
 *     comparava a DESCRICAO do termo no servidor ("Feminino") com o CODIGO que
 *     o aparelho manda, e o mesmo termo registrado por um colega virava
 *     divergencia falsa. E, com numero e data gravados no tipo certo (db/10),
 *     "1.80" do aparelho e 1.800 do banco sao o mesmo valor.
 */
export function chaveDoAparelho(tpDado: string | null, v: { coValor?: string | null; dsValor?: string | null }): string {
  if (v.coValor) return `T:${v.coValor}`;
  const texto = (v.dsValor ?? '').trim();
  if (tpDado === 'N' && NUMERO.test(texto)) return `N:${Number(texto)}`;
  if (tpDado === 'D' && DATA.test(texto)) return `D:${texto}`;
  return `X:${texto}`;
}

export function chaveDoServidor(l: {
  tp_dado: string | null;
  co_termo: string | null;
  ds_valor: string | null;
  vl_numerico: string | null;
  dt_valor: string | null;
}): string {
  if (l.co_termo !== null) return `T:${l.co_termo}`;
  if (l.vl_numerico !== null) return `N:${Number(l.vl_numerico)}`;
  if (l.dt_valor !== null) return `D:${l.dt_valor.slice(0, 10)}`;
  return chaveDoAparelho(l.tp_dado, { dsValor: l.ds_valor });
}

/**
 * O valor de um atributo como sai para a tela. Termo controlado ganha do texto,
 * que ganha do número, que ganha da data (só uma coluna é preenchida por vez).
 *
 * Número e data saem no formato brasileiro, venham da coluna do tipo (db/10)
 * ou de texto gravado antes dela.
 */
export function valorDoAtributo(l: {
  tp_dado?: string | null;
  no_termo: string | null;
  ds_valor: string | null;
  vl_numerico: string | null;
  dt_valor: string | null;
}): string | null {
  if (l.no_termo !== null) return l.no_termo;
  if (l.ds_valor !== null) {
    if (l.tp_dado === 'N') return numeroLegivel(l.ds_valor);
    if (l.tp_dado === 'D') return dataLegivel(l.ds_valor);
    return l.ds_valor;
  }
  return numeroLegivel(l.vl_numerico) ?? dataLegivel(l.dt_valor);
}
