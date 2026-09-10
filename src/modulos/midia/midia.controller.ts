import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Publico } from '@/acesso/publico.decorator';
import { MidiaService } from './midia.service';
import type { HandleUploadBody } from '@vercel/blob/client';

/**
 * Uma unica rota, dois papeis — ver o comentario em MidiaService. Publica no
 * Nest porque o segundo papel (webhook do Vercel Blob) nao tem Bearer; o
 * primeiro papel (aparelho pedindo token) e autenticado manualmente dentro
 * do servico.
 */
@ApiTags('midia')
@Controller('midia')
export class MidiaController {
  constructor(private readonly servico: MidiaService) {}

  @Post('upload')
  @Publico()
  @ApiOperation({ summary: 'Emite token de upload direto para o Vercel Blob (store identificasus-fotos)' })
  upload(@Body() body: HandleUploadBody, @Req() req: Request) {
    return this.servico.tratarUpload(body, req);
  }
}
