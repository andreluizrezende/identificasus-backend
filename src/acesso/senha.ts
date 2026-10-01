import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

/**
 * Política e guarda da senha do profissional.
 *
 * (!) A SENHA MORA EM `mob_usuario.ds_senha_hash`, E SÓ LÁ. Até a versão
 *     anterior quem guardava credencial era o Keycloak (ADR-09); ele saiu da
 *     arquitetura e a credencial veio para o dbsamu. Continua valendo a regra
 *     que justificava o Keycloak: UM lugar só guarda senha. Não há cópia em
 *     outro serviço, em log ou na trilha de auditoria.
 *
 * (!) SCRYPT, E NÃO BCRYPT. bcrypt corta a senha em 72 bytes sem avisar — duas
 *     senhas longas com o mesmo começo viram a mesma senha. scrypt não tem esse
 *     teto e vem no `node:crypto`, sem dependência nova.
 *
 * (!) OS PARÂMETROS VIAJAM DENTRO DO HASH (`scrypt$<log2 N>$<r>$<p>$sal$hash`).
 *     Subir o custo amanhã não invalida as senhas de hoje: cada hash é
 *     conferido com os parâmetros com que foi gerado.
 */

/** Comprimento mínimo; a tela de redefinição do app usa o mesmo número. */
export const SENHA_MINIMA = 10;
export const SENHA_MAXIMA = 200;

// OWASP (2025): scrypt com N=2^17, r=8, p=1. Custa 128 MiB por conferência.
const LOG2_N = 17;
const R = 8;
const P = 1;
const BYTES_SAL = 16;
const BYTES_HASH = 64;

function scrypt(senha: string, sal: Buffer, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, rejeita) => {
    scryptCallback(senha.normalize('NFKC'), sal, BYTES_HASH, opcoes, (erro, chave) => {
      if (erro) rejeita(erro);
      else resolve(chave);
    });
  });
}

function opcoes(log2N: number, r: number, p: number): ScryptOptions {
  // maxmem com folga: o padrão do Node (32 MiB) recusa N=2^17.
  return { N: 2 ** log2N, r, p, maxmem: 256 * 1024 * 1024 };
}

/**
 * O que a política recusa, em texto para a pessoa, ou `null` quando a senha
 * serve. Espelha o realm antigo: comprimento mínimo e "não pode ser o e-mail".
 */
export function motivoDaRecusa(senha: string, email: string | null): string | null {
  if (senha.length < SENHA_MINIMA) return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > SENHA_MAXIMA) return `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`;
  if (email && senha.trim().toLowerCase() === email.trim().toLowerCase()) {
    return 'A senha não pode ser o próprio e-mail.';
  }
  return null;
}

export async function cifrarSenha(senha: string): Promise<string> {
  const sal = randomBytes(BYTES_SAL);
  const hash = await scrypt(senha, sal, opcoes(LOG2_N, R, P));
  return ['scrypt', LOG2_N, R, P, sal.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * Hash de uma senha que ninguém tem, gerado uma vez por processo.
 *
 * (!) CONTA INEXISTENTE GASTA O MESMO TEMPO QUE SENHA ERRADA. Sem isto, a
 *     resposta para e-mail desconhecido volta em microssegundos e a de e-mail
 *     cadastrado em centenas de milissegundos — o cronômetro entregaria a lista
 *     de quem trabalha aqui, que a resposta única de 401 existe para esconder.
 */
let hashDeEngodo: Promise<string> | null = null;

/** `guardado` nulo (conta inexistente ou sem senha) é conferido contra o engodo e nunca bate. */
export async function conferirSenha(senha: string, guardado: string | null): Promise<boolean> {
  if (!guardado) {
    hashDeEngodo ??= cifrarSenha(randomBytes(32).toString('base64'));
    await conferir(senha, await hashDeEngodo);
    return false;
  }
  return conferir(senha, guardado);
}

async function conferir(senha: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, log2N, r, p, salB64, hashB64] = partes;
  const [n, rr, pp] = [Number(log2N), Number(r), Number(p)];
  // Parâmetro fora da faixa é hash corrompido, não convite para gastar memória.
  if (![n, rr, pp].every(Number.isInteger) || n < 14 || n > 20 || rr < 1 || rr > 32 || pp < 1 || pp > 4) {
    return false;
  }
  const esperado = Buffer.from(hashB64 ?? '', 'base64');
  if (esperado.length === 0) return false;

  const obtido = await scrypt(senha, Buffer.from(salB64 ?? '', 'base64'), opcoes(n, rr, pp));
  // timingSafeEqual exige o mesmo comprimento; hash adulterado sai aqui.
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

/**
 * Quantas senhas a nova não pode repetir, contando a atual. Era o
 * `passwordHistory(3)` do realm do Keycloak (ver db/07_historico_de_senhas.sql).
 */
export const SENHAS_NO_HISTORICO = 3;

/**
 * A senha bate com algum destes hashes? Para no primeiro que bater.
 *
 * (!) CUSTA UM SCRYPT POR HASH, e cada um leva centenas de milissegundos. Quem
 *     chama confere uma vez só por troca: ver `Credencial.preparar`.
 */
export async function senhaJaUsada(senha: string, hashes: Array<string | null>): Promise<boolean> {
  for (const hash of hashes) {
    if (hash && (await conferirSenha(senha, hash))) return true;
  }
  return false;
}
