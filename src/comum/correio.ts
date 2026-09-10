import { Injectable, Logger } from '@nestjs/common';

export interface Mensagem {
  para: string;
  assunto: string;
  texto: string;
}

export type Entrega = { entregue: true } | { entregue: false; motivo: string };

/**
 * Entrega de e-mail.
 *
 * Referencia: fiocruz-backend/utils/correio.js. O contrato tem a forma de
 * producao — enviar({ para, assunto, texto }) —, entao trocar por SMTP, SES ou
 * o que a SMS oferecer substitui este servico e nao mexe em rota nenhuma.
 *
 * (!) O DRIVER DE DESENVOLVIMENTO IMPRIME O CODIGO NO LOG DO SERVIDOR. E uma
 *     conveniencia de maquina de desenvolvedor e um vazamento em qualquer outro
 *     lugar: quem le o log entra na conta de quem esqueceu a senha, sem passar
 *     pela caixa de e-mail. Por isso ele recusa rodar fora de desenvolvimento.
 *
 * (!) A RECUSA E EXPLICITA, E NAO SILENCIOSA. Sem canal configurado, a rota
 *     responde que nao conseguiu enviar. Fingir que enviou seria pior que o
 *     erro: a pessoa ficaria esperando um e-mail que nunca sai.
 *
 * (!) NAO LANCA. Devolve { entregue } e deixa quem chama decidir o que dizer a
 *     quem esta esperando — uma excecao aqui viraria 500 numa rota que tem
 *     resposta melhor para dar.
 */
@Injectable()
export class Correio {
  private readonly log = new Logger('correio');

  private get driver(): string {
    return process.env.CORREIO_DRIVER ?? 'console';
  }

  private get remetente(): string {
    return (
      process.env.SMTP_FROM ??
      process.env.CORREIO_DE ??
      'IdentificaSUS <nao-responda@saude.salvador.ba.gov.br>'
    );
  }

  private ambienteDeDesenvolvimento(): boolean {
    const env = process.env.NODE_ENV;
    return !env || env === 'development' || env === 'test';
  }

  private smtpConfigurado(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  configurado(): boolean {
    if (this.driver === 'smtp') return this.smtpConfigurado();
    if (this.driver === 'console') return this.ambienteDeDesenvolvimento();
    return false;
  }

  async enviar(mensagem: Mensagem): Promise<Entrega> {
    if (!mensagem.para || !mensagem.assunto || !mensagem.texto) {
      return { entregue: false, motivo: 'mensagem incompleta' };
    }

    if (!this.configurado()) {
      return {
        entregue: false,
        motivo:
          this.driver === 'smtp'
            ? 'driver smtp sem SMTP_HOST, SMTP_USER ou SMTP_PASS no ambiente'
            : `driver de correio "${this.driver}" nao pode entregar em NODE_ENV=${process.env.NODE_ENV}`,
      };
    }

    if (this.driver === 'smtp') return this.enviarPorSmtp(mensagem);

    this.log.log(
      [
        '',
        '--- CORREIO (driver de desenvolvimento) ---',
        `para:    ${mensagem.para}`,
        `assunto: ${mensagem.assunto}`,
        mensagem.texto,
        '-------------------------------------------',
      ].join('\n'),
    );
    return { entregue: true };
  }

  /**
   * (!) CONEXAO POR ENVIO, e nao um transporte criado no carregamento do
   *     modulo. Criar no boot faria o servidor abrir socket com o provedor
   *     antes de qualquer pedido, e faria os testes dependerem de rede.
   *     Recuperacao de senha e rara: o custo de conectar na hora e irrelevante.
   */
  private async enviarPorSmtp(mensagem: Mensagem): Promise<Entrega> {
    try {
      // Import tardio pelo mesmo motivo acima; nodemailer so entra quando o
      // driver smtp esta em uso.
      const { createTransport } = await import('nodemailer');
      const porta = Number(process.env.SMTP_PORT ?? 587);
      // 465 e TLS direto; 587 sobe para TLS com STARTTLS. SMTP_SECURE explicito
      // ganha da porta: ha servidor que fala TLS direto fora do padrao, e
      // adivinhar errado da erro de handshake que nao diz o que houve.
      const seguro =
        process.env.SMTP_SECURE === undefined || process.env.SMTP_SECURE === ''
          ? porta === 465
          : process.env.SMTP_SECURE === 'true';

      const transporte = createTransport({
        host: process.env.SMTP_HOST,
        port: porta,
        secure: seguro,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      await transporte.sendMail({
        from: this.remetente,
        to: mensagem.para,
        subject: mensagem.assunto,
        text: mensagem.texto,
      });
      return { entregue: true };
    } catch (erro) {
      // (!) O motivo vai para quem chama e para o log, NUNCA para a resposta da
      //     rota: "usuario SMTP invalido" contaria mais sobre o servidor do que
      //     quem pediu o codigo precisa saber.
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      this.log.error(`smtp: ${motivo}`);
      return { entregue: false, motivo: `smtp: ${motivo}` };
    }
  }
}
