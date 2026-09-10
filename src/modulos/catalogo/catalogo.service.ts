import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { BancoPorFinalidade } from '@/acesso/banco-por-finalidade.service';

interface LinhaGrupo extends RowDataPacket {
  co_grupo: string; no_grupo: string; nu_ordem: number;
}
interface LinhaAtributo extends RowDataPacket {
  co_grupo: string; co_atributo: string; no_atributo: string; ds_atributo: string | null;
  tp_dado: string; lg_obrigatorio: number; lg_minimo_protocolo: number; nu_ordem: number;
}
interface LinhaVocabulario extends RowDataPacket {
  co_atributo: string; co_valor: string; ds_valor: string; nu_ordem: number;
}
interface LinhaProcedencia extends RowDataPacket {
  co_procedencia: string; ds_procedencia: string; vl_confiabilidade: string;
}

export interface Catalogo {
  versao: string;
  procedencias: Array<{ codigo: string; descricao: string; confiabilidade: number }>;
  grupos: Array<{
    codigo: string; nome: string; ordem: number;
    atributos: Array<{
      codigo: string; nome: string; descricao: string | null; tipo: string;
      obrigatorio: boolean; minimoDoProtocolo: boolean; ordem: number;
      valores: Array<{ codigo: string; descricao: string; ordem: number }>;
    }>;
  }>;
}

/**
 * Catalogo do protocolo: etapas, atributos, vocabulario e procedencias.
 *
 * (!) E O QUE PERMITE MUDAR O PROTOCOLO SEM PUBLICAR APP NOVO. Os atributos
 *     minimos sao decididos no OE2, entre os meses 6 e 12; quando mudarem, o
 *     que muda e uma linha em mob_tipo_atributo, nao uma versao do PWA.
 *
 * (!) A VERSAO E UM HASH DO CONTEUDO, e nao um numero mantido a mao. O app
 *     guarda o catalogo para funcionar offline e so precisa baixar de novo
 *     quando algo muda de verdade — um contador manual erra nas duas direcoes.
 */
@Injectable()
export class CatalogoService {
  constructor(private readonly acesso: BancoPorFinalidade) {}

  async listar(): Promise<Catalogo> {
    const [grupos, atributos, vocabulario, procedencias] = await Promise.all([
      this.acesso.consultar<LinhaGrupo>('ASSISTENCIAL',
        `SELECT co_grupo, no_grupo, nu_ordem FROM mob_grupo_atributo
          WHERE st_ativo = 'A' ORDER BY nu_ordem`),
      this.acesso.consultar<LinhaAtributo>('ASSISTENCIAL',
        `SELECT g.co_grupo, a.co_atributo, a.no_atributo, a.ds_atributo, a.tp_dado,
                a.lg_obrigatorio, a.lg_minimo_protocolo, a.nu_ordem
           FROM mob_tipo_atributo a
           JOIN mob_grupo_atributo g ON g.id_grupo_atributo = a.id_grupo_atributo
          WHERE a.st_ativo = 'A' ORDER BY g.nu_ordem, a.nu_ordem`),
      this.acesso.consultar<LinhaVocabulario>('ASSISTENCIAL',
        `SELECT a.co_atributo, v.co_valor, v.ds_valor, v.nu_ordem
           FROM mob_vocabulario v
           JOIN mob_tipo_atributo a ON a.id_tipo_atributo = v.id_tipo_atributo
          WHERE v.st_ativo = 'A' ORDER BY a.co_atributo, v.nu_ordem`),
      this.acesso.consultar<LinhaProcedencia>('ASSISTENCIAL',
        `SELECT co_procedencia, ds_procedencia, vl_confiabilidade
           FROM mob_procedencia ORDER BY vl_confiabilidade DESC`),
    ]);

    const porAtributo = new Map<string, LinhaVocabulario[]>();
    for (const v of vocabulario) {
      const lista = porAtributo.get(v.co_atributo) ?? [];
      lista.push(v);
      porAtributo.set(v.co_atributo, lista);
    }

    const montado: Catalogo['grupos'] = grupos.map((g) => ({
      codigo: g.co_grupo,
      nome: g.no_grupo,
      ordem: g.nu_ordem,
      atributos: atributos
        .filter((a) => a.co_grupo === g.co_grupo)
        .map((a) => ({
          codigo: a.co_atributo,
          nome: a.no_atributo,
          descricao: a.ds_atributo,
          tipo: a.tp_dado,
          obrigatorio: a.lg_obrigatorio === 1,
          minimoDoProtocolo: a.lg_minimo_protocolo === 1,
          ordem: a.nu_ordem,
          valores: (porAtributo.get(a.co_atributo) ?? []).map((v) => ({
            codigo: v.co_valor, descricao: v.ds_valor, ordem: v.nu_ordem,
          })),
        })),
    }));

    const corpo = {
      procedencias: procedencias.map((p) => ({
        codigo: p.co_procedencia,
        descricao: p.ds_procedencia,
        confiabilidade: Number(p.vl_confiabilidade),
      })),
      grupos: montado,
    };

    return {
      versao: createHash('sha256').update(JSON.stringify(corpo)).digest('hex').slice(0, 16),
      ...corpo,
    };
  }
}
