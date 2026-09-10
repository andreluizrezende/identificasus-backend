import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Montagem do app, compartilhada entre o processo tradicional (`main.ts`,
 * `app.listen()`) e o handler serverless (`serverless.ts`, `app.init()` sem
 * `listen`) — as duas formas de subir precisam do mesmo helmet, prefixo,
 * trava do CEP e swagger; só quem chama `.listen()` muda.
 */
export async function criarApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.setGlobalPrefix('api');
  // (!) SEM ValidationPipe GLOBAL. Ele e do mundo class-validator/DTO com
  //     decorators, e este projeto valida com Zod em cada fronteira
  //     (`ZodValidacaoPipe`, aplicado por rota). Deixado aqui, o pipe exigia o
  //     pacote `class-validator` — que nao esta instalado, porque nao e usado —
  //     e derrubava a API na inicializacao. Duas camadas de validacao com
  //     filosofias diferentes tambem seria pior do que uma: a mensagem de erro
  //     passaria a depender de qual das duas reprovou primeiro.

  // Trava anterior a aprovacao do CEP (RNF-05.02): sem o registro da
  // aprovacao, o servico se recusa a subir em producao.
  if (process.env.CEP_APROVADO !== '1' && process.env.NODE_ENV === 'production') {
    throw new Error(
      'CEP_APROVADO=0: nenhum dado individual pode ser tratado antes da aprovacao do Comite de Etica.',
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('IdentificaSUS - API')
        .setDescription('Nucleo de Resolucao de Identidade. O sistema sugere; a decisao e humana.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  return app;
}
