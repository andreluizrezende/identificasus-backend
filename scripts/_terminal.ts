/**
 * Perguntas no terminal, com e sem eco.
 *
 * Portado de fiocruz-backend/scripts/_terminal.js, com as duas advertencias
 * que estao la:
 *
 * (!) O BUFFER E DO MODULO, e nao de cada pergunta. Um ouvinte novo por
 *     pergunta perde o que ja estava no buffer entre uma e outra.
 *
 * (!) NENHUM SCRIPT ACEITA SENHA POR ARGUMENTO. Argumento de linha de comando
 *     fica no historico do shell e aparece na lista de processos para qualquer
 *     outro usuario da maquina.
 */

// Teclas de controle por CODIGO, e nao por escape literal.
const ENTER = [10, 13, 4];
const CANCELA = 3;
const APAGA = [8, 127];

let buffer = '';

function lerLinha(): Promise<string> {
  return new Promise((resolve) => {
    const tentar = (): boolean => {
      const fim = buffer.indexOf('\n');
      if (fim < 0) return false;
      const linha = buffer.slice(0, fim).replace(/\r$/, '');
      buffer = buffer.slice(fim + 1);
      resolve(linha.trim());
      return true;
    };
    if (tentar()) return;

    const aoLer = (pedaco: string): void => {
      buffer += pedaco;
      if (tentar()) {
        process.stdin.removeListener('data', aoLer);
        process.stdin.pause();
      }
    };
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', aoLer);
  });
}

export function perguntar(rotulo: string): Promise<string> {
  process.stdout.write(rotulo);
  return lerLinha();
}

/** Cada tecla vira um asterisco. Sem TTY, nao ha eco a suprimir. */
export function perguntarOculto(rotulo: string): Promise<string> {
  process.stdout.write(rotulo);
  if (process.stdin.isTTY !== true) return lerLinha();

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let valor = '';

    const aoLer = (ch: string): void => {
      const cod = ch.charCodeAt(0);

      if (ENTER.includes(cod)) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', aoLer);
        process.stdout.write('\n');
        resolve(valor);
        return;
      }
      if (cod === CANCELA) {
        process.stdout.write('\n');
        process.exit(1);
      }
      if (APAGA.includes(cod)) {
        if (valor.length > 0) {
          valor = valor.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      valor += ch;
      process.stdout.write('*');
    };

    process.stdin.on('data', aoLer);
  });
}
