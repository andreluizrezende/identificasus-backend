import { z } from 'zod';

/**
 * Cadastro pela tela de administração (US-34): profissionais, aparelhos e
 * estações. Bases e viaturas continuam vindo do cadastro oficial da SMS
 * (cadastro-sms/), que é planilha e não tela.
 */

/** Finalidades que uma conta pode ter (ck_mob_usuario_co_finalidade, db/08). */
export const FINALIDADES = ['ASSISTENCIAL', 'ADJUDICACAO', 'ADMINISTRACAO', 'AUDITORIA', 'PESQUISA'] as const;

/** "-HOM-" é reservado ao cadastro de homologação (db/04), como no importador. */
export const MARCA_DE_HOMOLOGACAO = '-HOM-';

/** Confere os dois dígitos verificadores do CPF. Sequências repetidas são inválidas. */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(cpf[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/** CPF para lista: só o miolo, como o gov.br mostra (***.456.789-**). */
export function cpfMascarado(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

const perfis = z.array(z.string().trim().toUpperCase().min(1).max(20)).max(10)
  .transform((l) => [...new Set(l)]);

export const esquemaNovoProfissional = z.object({
  nome: z.string().trim().min(3).max(120),
  cpf: z.string().transform((v) => v.replace(/\D/g, '')).refine(cpfValido, 'CPF inválido'),
  email: z.string().trim().toLowerCase().email().max(180),
  cargo: z.string().trim().max(60).nullish().transform((v) => v || null),
  conselho: z.string().trim().max(30).nullish().transform((v) => v || null),
  finalidade: z.enum(FINALIDADES),
  perfis,
});
export type NovoProfissional = z.infer<typeof esquemaNovoProfissional>;

/** Alteração parcial: só o que veio muda. Nome, CPF e e-mail não mudam por aqui. */
export const esquemaAlteracaoProfissional = z.object({
  ativo: z.boolean().optional(),
  finalidade: z.enum(FINALIDADES).optional(),
  perfis: perfis.optional(),
}).refine((d) => d.ativo !== undefined || d.finalidade !== undefined || d.perfis !== undefined, 'Nada a alterar');
export type AlteracaoProfissional = z.infer<typeof esquemaAlteracaoProfissional>;

export const esquemaNovoAparelho = z.object({
  codigo: z.string().trim().toUpperCase().min(2).max(30)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Só letras, números e "-"')
    .refine((c) => !c.includes(MARCA_DE_HOMOLOGACAO), 'O trecho "-HOM-" é reservado à homologação'),
  base: z.string().trim().toUpperCase().min(1).max(20),
  modelo: z.string().trim().max(80).nullish().transform((v) => v || null),
});
export type NovoAparelho = z.infer<typeof esquemaNovoAparelho>;

export const esquemaRevogacao = z.object({
  motivo: z.string().trim().min(10).max(200),
});
export type Revogacao = z.infer<typeof esquemaRevogacao>;
