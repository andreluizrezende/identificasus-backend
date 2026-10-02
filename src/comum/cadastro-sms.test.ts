import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerCadastro, planejar, separarCampos } from '../../scripts/cadastro-sms';
import type { NoBanco } from '../../scripts/cadastro-sms';

const BASES = 'codigo;nome;sigla;endereco;latitude;longitude;implantacao\n'
  + 'SAMU-01;Base Norte;NOR;"Rua A; 10";-12,95;-38,45;2027-03-01\n'
  + 'SAMU-CR;Central de Regulacao;REG;;;;\n';
const VIATURAS = 'codigo;base;tipo\nUSB-01;SAMU-01;usb\n';
const APARELHOS = 'codigo;base;modelo\nTAB-0001;SAMU-01;Tablet\nEST-0001;SAMU-CR;\n';

const vazio = (): NoBanco => ({ bases: new Map(), viaturas: new Map(), aparelhos: new Map() });

describe('leitura das planilhas da SMS', () => {
  it('separa por ";" respeitando aspas', () => {
    expect(separarCampos('a;"b;c";"d ""e""";')).toEqual(['a', 'b;c', 'd "e"', '']);
  });

  it('le as tres planilhas: virgula decimal, maiusculas, campos vazios viram null', () => {
    const { cadastro, erros } = lerCadastro({ bases: BASES, viaturas: VIATURAS, aparelhos: APARELHOS });
    expect(erros).toEqual([]);
    expect(cadastro.bases[0]).toEqual({
      codigo: 'SAMU-01', nome: 'Base Norte', sigla: 'NOR', endereco: 'Rua A; 10',
      latitude: -12.95, longitude: -38.45, implantacao: '2027-03-01',
    });
    expect(cadastro.bases[1]).toMatchObject({ sigla: 'REG', endereco: null, latitude: null, implantacao: null });
    expect(cadastro.viaturas[0]).toEqual({ codigo: 'USB-01', base: 'SAMU-01', tipo: 'USB' });
    expect(cadastro.aparelhos[1]).toEqual({ codigo: 'EST-0001', base: 'SAMU-CR', modelo: null });
  });

  it('aceita o BOM do Excel e ignora linha vazia e comentario', () => {
    const { cadastro, erros } = lerCadastro({
      bases: `\uFEFF${BASES}\n# comentario\n\n`, viaturas: VIATURAS, aparelhos: APARELHOS,
    });
    expect(erros).toEqual([]);
    expect(cadastro.bases).toHaveLength(2);
  });

  it('os modelos da pasta cadastro-sms/modelo leem sem erro e sem linha', () => {
    const ler = (n: string) => readFileSync(resolve(__dirname, '../../cadastro-sms/modelo', n), 'utf8');
    const { cadastro, erros } = lerCadastro({ bases: ler('bases.csv'), viaturas: ler('viaturas.csv'), aparelhos: ler('aparelhos.csv') });
    expect(erros).toEqual([]);
    expect(cadastro).toEqual({ bases: [], viaturas: [], aparelhos: [] });
  });

  it('(!) aponta arquivo e linha de cada erro, e junta todos', () => {
    const { erros } = lerCadastro({
      bases: 'codigo;nome;sigla;endereco;latitude;longitude;implantacao\n'
        + 'SAMU 01;;;;-12;;2027-02-30\n'
        + 'SAMU-02;Base;;;-95;-38;\n'
        + 'SAMU-02;Repetida;;;;;\n',
      viaturas: 'codigo;base;tipo\nUSB-9;SAMU-02;VAN\n',
      aparelhos: 'codigo;base;modelo\nAPAR-HOM-0009;SAMU-02;\n',
    });
    expect(erros).toEqual(expect.arrayContaining([
      expect.stringMatching(/bases\.csv, linha 2: codigo "SAMU 01" so pode ter/),
      expect.stringMatching(/bases\.csv, linha 2: nome vazio/),
      expect.stringMatching(/bases\.csv, linha 2: latitude e longitude vao juntas/),
      expect.stringMatching(/bases\.csv, linha 2: implantacao "2027-02-30"/),
      expect.stringMatching(/bases\.csv, linha 3: latitude "-95" fora do intervalo/),
      expect.stringMatching(/bases\.csv, linha 4: codigo "SAMU-02" repetido/),
      expect.stringMatching(/viaturas\.csv, linha 2: tipo "VAN"/),
      expect.stringMatching(/aparelhos\.csv, linha 2: .*reservado a homologacao/),
    ]));
  });

  it('cabecalho sem coluna obrigatoria e erro, com o cabecalho esperado', () => {
    const { erros } = lerCadastro({ bases: 'codigo;nome\nX;Y\n', viaturas: VIATURAS, aparelhos: APARELHOS });
    expect(erros[0]).toMatch(/bases\.csv: cabecalho sem a\(s\) coluna\(s\) sigla, endereco/);
  });
});

describe('plano contra o banco', () => {
  const { cadastro } = lerCadastro({ bases: BASES, viaturas: VIATURAS, aparelhos: APARELHOS });

  it('banco vazio: tudo novo', () => {
    const p = planejar(cadastro, vazio());
    expect(p.erros).toEqual([]);
    expect(p.bases.novas).toEqual(['SAMU-01', 'SAMU-CR']);
    expect(p.viaturas.novas).toEqual(['USB-01']);
    expect(p.aparelhos.novos).toEqual(['TAB-0001', 'EST-0001']);
  });

  it('rodar de novo com a mesma planilha: tudo igual', () => {
    const banco = vazio();
    for (const b of cadastro.bases) banco.bases.set(b.codigo, { ...b, ativo: true });
    banco.viaturas.set('USB-01', { base: 'SAMU-01', tipo: 'USB', ativo: true });
    banco.aparelhos.set('TAB-0001', { base: 'SAMU-01', modelo: 'Tablet', ativo: true, revogadoEm: null });
    banco.aparelhos.set('EST-0001', { base: 'SAMU-CR', modelo: null, ativo: true, revogadoEm: null });
    const p = planejar(cadastro, banco);
    expect(p.bases.iguais).toHaveLength(2);
    expect(p.viaturas.iguais).toEqual(['USB-01']);
    expect(p.aparelhos.iguais).toHaveLength(2);
    expect([...p.bases.novas, ...p.bases.alteradas, ...p.aparelhos.novos, ...p.aparelhos.alterados]).toEqual([]);
  });

  it('aparelho que troca de base aparece destacado', () => {
    const banco = vazio();
    banco.aparelhos.set('TAB-0001', { base: 'SAMU-CR', modelo: 'Tablet', ativo: true, revogadoEm: null });
    const p = planejar(cadastro, banco);
    expect(p.aparelhos.mudamDeBase).toEqual(['TAB-0001: SAMU-CR -> SAMU-01']);
  });

  it('(!) aparelho revogado nao volta por planilha', () => {
    const banco = vazio();
    banco.aparelhos.set('TAB-0001', { base: 'SAMU-01', modelo: 'Tablet', ativo: false, revogadoEm: '2027-05-01 10:00' });
    const p = planejar(cadastro, banco);
    expect(p.erros).toEqual([expect.stringMatching(/TAB-0001: revogado em 2027-05-01 10:00/)]);
  });

  it('base inexistente, ou de homologacao, barra a viatura e o aparelho', () => {
    const { cadastro: c } = lerCadastro({
      bases: 'codigo;nome;sigla;endereco;latitude;longitude;implantacao\n',
      viaturas: 'codigo;base;tipo\nUSB-01;SAMU-99;USB\n',
      aparelhos: 'codigo;base;modelo\nTAB-0001;BASE-HOM-01;\n',
    });
    const banco = vazio();
    banco.bases.set('BASE-HOM-01', { nome: 'Base Centro', sigla: null, endereco: null, latitude: null, longitude: null, implantacao: null, ativo: true });
    const p = planejar(c, banco);
    expect(p.erros).toEqual([
      expect.stringMatching(/viatura USB-01: base "SAMU-99" nao esta/),
      expect.stringMatching(/aparelho TAB-0001: base "BASE-HOM-01" e de homologacao/),
    ]);
  });

  it('lista os *-HOM-* ativos que aposentar desativaria, sem os ja revogados', () => {
    const banco = vazio();
    banco.bases.set('BASE-HOM-01', { nome: 'x', sigla: null, endereco: null, latitude: null, longitude: null, implantacao: null, ativo: true });
    banco.aparelhos.set('APAR-HOM-0001', { base: 'BASE-HOM-01', modelo: null, ativo: true, revogadoEm: null });
    banco.aparelhos.set('APAR-HOM-9999', { base: 'BASE-HOM-01', modelo: null, ativo: false, revogadoEm: '2026-10-02 00:00' });
    const p = planejar(cadastro, banco);
    expect(p.homologacao.bases).toEqual(['BASE-HOM-01']);
    expect(p.homologacao.aparelhos).toEqual(['APAR-HOM-0001']);
  });
});
