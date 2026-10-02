/**
 * Cadastro oficial de bases, viaturas e aparelhos, vindo da SMS: leitura,
 * conferencia e plano. Sem banco aqui: quem grava e scripts/importar-cadastro-sms.ts.
 *
 * Formato: tres arquivos CSV numa pasta, separados por ";" (o que o Excel em
 * portugues exporta), UTF-8, com cabecalho. Modelo em cadastro-sms/modelo.
 *
 *   bases.csv     codigo;nome;sigla;endereco;latitude;longitude;implantacao
 *   viaturas.csv  codigo;base;tipo
 *   aparelhos.csv codigo;base;modelo
 *
 * (!) NADA SE GRAVA COM UM ERRO NA PLANILHA. Uma linha errada barra a carga
 *     inteira, e a lista de erros diz arquivo e linha. Carga pela metade e o
 *     pior estado possivel: a SMS acha que o tablet esta liberado, e ele nao
 *     entra.
 *
 * (!) "-HOM-" E RESERVADO a carga de homologacao (db/04). Um codigo oficial
 *     com isso no nome seria aposentado junto com os de teste.
 *
 * (!) APARELHO REVOGADO NAO VOLTA POR PLANILHA. Revogar e a resposta a tablet
 *     perdido ou roubado; uma planilha antiga reenviada nao pode reabrir a
 *     porta. Reativar e decisao a parte, feita no banco por quem responde por
 *     ela.
 */

export const TIPOS_DE_VIATURA = ['USB', 'USA', 'MOT', 'EMB'] as const;
export const MARCA_DE_HOMOLOGACAO = '-HOM-';
const CODIGO = /^[A-Z0-9][A-Z0-9-]*$/;

export interface Base {
  codigo: string; nome: string; sigla: string | null; endereco: string | null;
  latitude: number | null; longitude: number | null; implantacao: string | null;
}
export interface Viatura { codigo: string; base: string; tipo: (typeof TIPOS_DE_VIATURA)[number] }
export interface Aparelho { codigo: string; base: string; modelo: string | null }
export interface Cadastro { bases: Base[]; viaturas: Viatura[]; aparelhos: Aparelho[] }

export interface Leitura { cadastro: Cadastro; erros: string[] }

/** Separa uma linha de CSV com ";", respeitando aspas ("a;b" e "" dentro). */
export function separarCampos(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { atual += '"'; i += 1; }
      else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { campos.push(atual.trim()); atual = ''; }
    else atual += c;
  }
  campos.push(atual.trim());
  return campos;
}

/** Linhas de dados de um CSV, como objetos pelo cabecalho, com o numero da linha no arquivo. */
export function lerCsv(
  texto: string, arquivo: string, colunas: readonly string[], erros: string[],
): { linha: number; valores: Record<string, string> }[] {
  const linhas = (texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto).split(/\r?\n/);
  const cabecalho = separarCampos(linhas[0] ?? '').map((c) => c.toLowerCase());
  const faltando = colunas.filter((c) => !cabecalho.includes(c));
  if (faltando.length > 0) {
    erros.push(`${arquivo}: cabecalho sem a(s) coluna(s) ${faltando.join(', ')}. Esperado: ${colunas.join(';')}`);
    return [];
  }
  const saida: { linha: number; valores: Record<string, string> }[] = [];
  linhas.slice(1).forEach((bruta, i) => {
    if (bruta.trim() === '' || bruta.trim().startsWith('#')) return;
    const campos = separarCampos(bruta);
    const valores: Record<string, string> = {};
    cabecalho.forEach((c, j) => { valores[c] = campos[j] ?? ''; });
    saida.push({ linha: i + 2, valores });
  });
  return saida;
}

function texto(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

function conferirCodigo(
  valor: string, maximo: number, onde: string, erros: string[], vistos: Set<string>,
): string | null {
  const codigo = valor.trim().toUpperCase();
  if (!codigo) { erros.push(`${onde}: codigo vazio`); return null; }
  if (codigo.length > maximo) erros.push(`${onde}: codigo "${codigo}" passa de ${maximo} caracteres`);
  if (!CODIGO.test(codigo)) erros.push(`${onde}: codigo "${codigo}" so pode ter letras, numeros e "-"`);
  if (codigo.includes(MARCA_DE_HOMOLOGACAO)) {
    erros.push(`${onde}: codigo "${codigo}" usa "${MARCA_DE_HOMOLOGACAO}", reservado a homologacao`);
  }
  if (vistos.has(codigo)) erros.push(`${onde}: codigo "${codigo}" repetido no arquivo`);
  vistos.add(codigo);
  return codigo;
}

function conferirTexto(
  valor: string | undefined, maximo: number, campo: string, onde: string, erros: string[],
): string | null {
  const t = texto(valor);
  if (t && t.length > maximo) erros.push(`${onde}: ${campo} passa de ${maximo} caracteres`);
  return t;
}

function conferirNumero(
  valor: string | undefined, min: number, max: number, campo: string, onde: string, erros: string[],
): number | null {
  const t = texto(valor);
  if (t === null) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) {
    erros.push(`${onde}: ${campo} "${t}" fora do intervalo ${min} a ${max}`);
    return null;
  }
  return n;
}

function conferirData(valor: string | undefined, onde: string, erros: string[]): string | null {
  const t = texto(valor);
  if (t === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !d || d.getUTCDate() !== Number(m[3])) {
    erros.push(`${onde}: implantacao "${t}" nao e uma data AAAA-MM-DD valida`);
    return null;
  }
  return t;
}

/** Le os tres arquivos e confere tudo que da para conferir sem o banco. */
export function lerCadastro(arquivos: { bases: string; viaturas: string; aparelhos: string }): Leitura {
  const erros: string[] = [];
  const bases: Base[] = [];
  const viaturas: Viatura[] = [];
  const aparelhos: Aparelho[] = [];

  const vistosB = new Set<string>();
  for (const { linha, valores: v } of lerCsv(arquivos.bases, 'bases.csv',
    ['codigo', 'nome', 'sigla', 'endereco', 'latitude', 'longitude', 'implantacao'], erros)) {
    const onde = `bases.csv, linha ${linha}`;
    // Todos os campos sao conferidos, mesmo com um ja errado: a SMS corrige a
    // planilha uma vez, e nao um erro por rodada.
    const codigo = conferirCodigo(v.codigo ?? '', 20, onde, erros, vistosB);
    const nome = conferirTexto(v.nome, 80, 'nome', onde, erros);
    if (!nome) erros.push(`${onde}: nome vazio`);
    const sigla = conferirTexto(v.sigla, 10, 'sigla', onde, erros)?.toUpperCase() ?? null;
    const endereco = conferirTexto(v.endereco, 200, 'endereco', onde, erros);
    const latitude = conferirNumero(v.latitude, -90, 90, 'latitude', onde, erros);
    const longitude = conferirNumero(v.longitude, -180, 180, 'longitude', onde, erros);
    if ((texto(v.latitude) === null) !== (texto(v.longitude) === null)) {
      erros.push(`${onde}: latitude e longitude vao juntas, ou nenhuma`);
    }
    const implantacao = conferirData(v.implantacao, onde, erros);
    if (codigo && nome) bases.push({ codigo, nome, sigla, endereco, latitude, longitude, implantacao });
  }

  const vistosV = new Set<string>();
  for (const { linha, valores: v } of lerCsv(arquivos.viaturas, 'viaturas.csv', ['codigo', 'base', 'tipo'], erros)) {
    const onde = `viaturas.csv, linha ${linha}`;
    const codigo = conferirCodigo(v.codigo ?? '', 20, onde, erros, vistosV);
    const base = (v.base ?? '').trim().toUpperCase();
    if (!base) erros.push(`${onde}: base vazia`);
    const tipo = (v.tipo ?? '').trim().toUpperCase();
    const tipoValido = TIPOS_DE_VIATURA.find((t) => t === tipo);
    if (!tipoValido) erros.push(`${onde}: tipo "${tipo}" nao e um de ${TIPOS_DE_VIATURA.join(', ')}`);
    if (codigo && base && tipoValido) viaturas.push({ codigo, base, tipo: tipoValido });
  }

  const vistosA = new Set<string>();
  for (const { linha, valores: v } of lerCsv(arquivos.aparelhos, 'aparelhos.csv', ['codigo', 'base', 'modelo'], erros)) {
    const onde = `aparelhos.csv, linha ${linha}`;
    const codigo = conferirCodigo(v.codigo ?? '', 30, onde, erros, vistosA);
    const base = (v.base ?? '').trim().toUpperCase();
    if (!base) erros.push(`${onde}: base vazia`);
    if (codigo && base) aparelhos.push({ codigo, base, modelo: conferirTexto(v.modelo, 80, 'modelo', onde, erros) });
  }

  return { cadastro: { bases, viaturas, aparelhos }, erros };
}

/** O que ja esta no banco, so o que o plano precisa comparar. */
export interface NoBanco {
  bases: Map<string, { nome: string; sigla: string | null; endereco: string | null; latitude: number | null;
    longitude: number | null; implantacao: string | null; ativo: boolean }>;
  viaturas: Map<string, { base: string; tipo: string; ativo: boolean }>;
  aparelhos: Map<string, { base: string; modelo: string | null; ativo: boolean; revogadoEm: string | null }>;
}

export interface Plano {
  bases: { novas: string[]; alteradas: string[]; iguais: string[] };
  viaturas: { novas: string[]; alteradas: string[]; iguais: string[] };
  aparelhos: { novos: string[]; alterados: string[]; iguais: string[]; mudamDeBase: string[] };
  /** Codigos *-HOM-* ativos que `--aposentar-homologacao` desativaria. */
  homologacao: { bases: string[]; viaturas: string[]; aparelhos: string[] };
  erros: string[];
}

/**
 * Compara a planilha com o banco. Erros aqui tambem barram a carga: base
 * que nao existe em lugar nenhum, aparelho revogado.
 */
export function planejar(c: Cadastro, banco: NoBanco): Plano {
  const erros: string[] = [];
  const basesConhecidas = new Set([...c.bases.map((b) => b.codigo), ...[...banco.bases.keys()]]);
  const plano: Plano = {
    bases: { novas: [], alteradas: [], iguais: [] },
    viaturas: { novas: [], alteradas: [], iguais: [] },
    aparelhos: { novos: [], alterados: [], iguais: [], mudamDeBase: [] },
    homologacao: {
      bases: [...banco.bases].filter(([k, v]) => v.ativo && k.includes(MARCA_DE_HOMOLOGACAO)).map(([k]) => k),
      viaturas: [...banco.viaturas].filter(([k, v]) => v.ativo && k.includes(MARCA_DE_HOMOLOGACAO)).map(([k]) => k),
      aparelhos: [...banco.aparelhos].filter(([k, v]) => v.ativo && !v.revogadoEm && k.includes(MARCA_DE_HOMOLOGACAO)).map(([k]) => k),
    },
    erros,
  };

  for (const b of c.bases) {
    const atual = banco.bases.get(b.codigo);
    if (!atual) plano.bases.novas.push(b.codigo);
    else if (
      !atual.ativo || atual.nome !== b.nome || atual.sigla !== b.sigla || atual.endereco !== b.endereco
      || atual.latitude !== b.latitude || atual.longitude !== b.longitude || atual.implantacao !== b.implantacao
    ) plano.bases.alteradas.push(b.codigo);
    else plano.bases.iguais.push(b.codigo);
  }

  for (const v of c.viaturas) {
    if (!basesConhecidas.has(v.base)) erros.push(`viatura ${v.codigo}: base "${v.base}" nao esta em bases.csv nem no banco`);
    else if (v.base.includes(MARCA_DE_HOMOLOGACAO)) erros.push(`viatura ${v.codigo}: base "${v.base}" e de homologacao`);
    const atual = banco.viaturas.get(v.codigo);
    if (!atual) plano.viaturas.novas.push(v.codigo);
    else if (!atual.ativo || atual.base !== v.base || atual.tipo !== v.tipo) plano.viaturas.alteradas.push(v.codigo);
    else plano.viaturas.iguais.push(v.codigo);
  }

  for (const a of c.aparelhos) {
    if (!basesConhecidas.has(a.base)) erros.push(`aparelho ${a.codigo}: base "${a.base}" nao esta em bases.csv nem no banco`);
    else if (a.base.includes(MARCA_DE_HOMOLOGACAO)) erros.push(`aparelho ${a.codigo}: base "${a.base}" e de homologacao`);
    const atual = banco.aparelhos.get(a.codigo);
    if (atual?.revogadoEm) {
      erros.push(`aparelho ${a.codigo}: revogado em ${atual.revogadoEm}. Planilha nao reativa aparelho revogado`);
      continue;
    }
    if (!atual) plano.aparelhos.novos.push(a.codigo);
    else if (!atual.ativo || atual.base !== a.base || atual.modelo !== a.modelo) {
      plano.aparelhos.alterados.push(a.codigo);
      if (atual.base !== a.base) plano.aparelhos.mudamDeBase.push(`${a.codigo}: ${atual.base} -> ${a.base}`);
    } else plano.aparelhos.iguais.push(a.codigo);
  }

  return plano;
}
