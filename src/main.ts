import { Logger } from '@nestjs/common';
import { criarApp } from './bootstrap';

async function inicializar(): Promise<void> {
  const app = await criarApp();
  const log = new Logger('inicializacao');

  const porta = Number(process.env.PORTA ?? 3000);
  await app.listen(porta);
  log.log(`API ouvindo em http://localhost:${porta}/api`);
}

void inicializar();
