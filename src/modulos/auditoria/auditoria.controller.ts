import { Controller, Get, Headers, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { Publico } from '@/acesso/publico.decorator';
import { AuditoriaService } from './auditoria.service';
import type { ResultadoDaVerificacao } from './auditoria.service';

/**
 * Verificação noturna da trilha (agendada em vercel.json, `crons`).
 *
 * (!) PÚBLICA PARA O GUARD, FECHADA PELO SEGREDO. O agendador da Vercel não
 *     tem login nem finalidade; ele manda `Authorization: Bearer <CRON_SECRET>`
 *     quando a variável existe no projeto. Sem a variável a rota fica fechada
 *     (503), e não aberta: verificação que qualquer um dispara vira um jeito
 *     de ler o tamanho da trilha e de pôr carga no banco.
 *
 * (!) A RESPOSTA NÃO TRAZ CONTEÚDO DA TRILHA, só o veredito e onde quebrou.
 *     O alarme é o log de erro: cadeia quebrada aparece nos logs da Vercel.
 */
@ApiExcludeController()
@Controller('auditoria')
export class AuditoriaController {
  private readonly log = new Logger('auditoria');

  constructor(private readonly auditoria: AuditoriaService) {}

  @Get('verificacao')
  @Publico()
  async verificar(@Headers('authorization') autorizacao?: string): Promise<ResultadoDaVerificacao> {
    const segredo = process.env.CRON_SECRET;
    if (!segredo) throw new ServiceUnavailableException({ mensagem: 'Verificação não configurada (CRON_SECRET).' });
    if (!confere(autorizacao ?? '', `Bearer ${segredo}`)) throw new UnauthorizedException();

    const r = await this.auditoria.verificarCadeia();
    if (r.integra) {
      this.log.log(`trilha integra: ${r.elos} elos, ${r.peloConteudo} conferidos pelo conteudo`);
    } else {
      this.log.error(`TRILHA QUEBRADA no id_auditoria ${r.quebrouEm} (${r.motivo}); ${r.elos} elos`);
    }
    return r;
  }
}

/** Comparação em tempo constante: o tempo de resposta não pode ensinar o segredo. */
function confere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
