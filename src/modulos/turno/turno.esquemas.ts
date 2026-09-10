import { z } from 'zod';

const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const esquemaAbertura = z.object({
  coDispositivo: z.string().trim().min(1).max(30),
  coViatura: z.string().trim().max(20).optional(),
  hrInicio: z.string().regex(HORA, 'hora no formato HH:MM'),
  hrFim: z.string().regex(HORA, 'hora no formato HH:MM'),
  dsFuncao: z.string().trim().max(60).optional(),
  /**
   * Guarnição por CPF, e não por nome: nome se repete numa base de 2 mil
   * profissionais, e é justamente na madrugada que ninguém quer desambiguar
   * "José Santos" numa lista.
   */
  guarnicao: z.array(z.string().regex(/^\d{11}$/)).max(8).optional(),
});
export type AberturaDeTurno = z.infer<typeof esquemaAbertura>;

export const esquemaEncerramento = z.object({
  ds_motivo: z.string().trim().max(120).optional(),
});
export type EncerramentoDeTurno = z.infer<typeof esquemaEncerramento>;

export interface TurnoAberto {
  idTurno: number;
  idBase: number;
  noBase: string;
  idViatura: number | null;
  coViatura: string | null;
  idDispositivo: number;
  hrInicio: string;
  hrFim: string;
  abertoEm: string;
  guarnicao: Array<{ noUsuario: string; dsFuncao: string | null }>;
}
