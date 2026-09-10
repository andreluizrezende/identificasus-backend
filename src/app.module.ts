import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AcessoModule } from './acesso/acesso.module';
import { AutenticacaoGuard } from './acesso/autenticacao.guard';
import { FinalidadeGuard } from './acesso/finalidade.guard';
import { FiltroExcecao } from './comum/filtro-excecao';
import { AuditoriaModule } from './modulos/auditoria/auditoria.module';
import { CapturaModule } from './modulos/captura/captura.module';
import { CasoModule } from './modulos/caso/caso.module';
import { CatalogoModule } from './modulos/catalogo/catalogo.module';
import { RecuperacaoModule } from './modulos/recuperacao/recuperacao.module';
import { SessaoModule } from './modulos/sessao/sessao.module';
import { SincronizacaoModule } from './modulos/sincronizacao/sincronizacao.module';
import { TurnoModule } from './modulos/turno/turno.module';

/**
 * Monolito modular (ADR-01). Um artefato, um banco, uma transacao.
 * As fronteiras entre modulos sao verificadas em CI pelo dependency-cruiser.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    AcessoModule,
    AuditoriaModule,
    CatalogoModule,
    CasoModule,
    CapturaModule,
    TurnoModule,
    SincronizacaoModule,
    RecuperacaoModule,
    SessaoModule,
  ],
  providers: [
    // (!) A ORDEM DESTES DOIS E SIGNIFICATIVA. O Nest executa os APP_GUARD na
    //     ordem em que sao declarados: autenticacao preenche req.user, e so
    //     depois o guard de finalidade tem o que comparar. Invertidos, todo
    //     req.user chega vazio e o segundo guard nega tudo — falha fechado,
    //     mas por engano, que e a pior maneira de estar certo.
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
    // Falha fechado: rota sem finalidade declarada nao passa.
    { provide: APP_GUARD, useClass: FinalidadeGuard },
    { provide: APP_FILTER, useClass: FiltroExcecao },
  ],
})
export class AppModule {}
