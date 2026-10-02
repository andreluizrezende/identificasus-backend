# Cadastro oficial de bases, viaturas e aparelhos

Enquanto a SMS não envia a lista oficial, a produção usa o cadastro fictício
de homologação (`db/04`: `BASE-HOM-*`, `USB-HOM-*`, `APAR-HOM-*`). Esta pasta
é o caminho para trocar um pelo outro.

## O que pedir à SMS

Três planilhas, no formato de `modelo/` (CSV separado por `;`, como o Excel
em português salva, com a primeira linha de cabeçalho). Linhas que começam
com `#` são ignoradas.

**`bases.csv`**: uma linha por base, incluindo a Central de Regulação.

| coluna | obrigatória | regra |
|---|---|---|
| `codigo` | sim | até 20 caracteres: letras, números e `-` |
| `nome` | sim | até 80 caracteres |
| `sigla` | não | até 10 caracteres |
| `endereco` | não | até 200 caracteres |
| `latitude`, `longitude` | não | as duas juntas, ou nenhuma (ponto ou vírgula decimal) |
| `implantacao` | não | `AAAA-MM-DD`; sustenta o indicador I9 |

**`viaturas.csv`**: `codigo` (até 20), `base` (código de uma base) e `tipo`
(`USB`, `USA`, `MOT` ou `EMB`).

**`aparelhos.csv`**: `codigo` (até 30; é o que vai na etiqueta do tablet e
o que se digita no login), `base` e `modelo` (opcional). As estações da
central são aparelhos da base da Central de Regulação.

O código `-HOM-` é reservado à homologação e é recusado.

## Como carregar

1. Salve as três planilhas numa pasta, com esses nomes de arquivo.
2. Veja o plano, sem gravar nada:

   ```
   powershell -ExecutionPolicy Bypass -File scripts\importar-cadastro-sms-producao.ps1 -Pasta C:\caminho\da\pasta
   ```

   O script pede a senha do `usr_samu`, confere as planilhas e mostra o que
   entra, o que muda e o que fica igual. Qualquer erro (linha, coluna, base
   que não existe, aparelho revogado) é listado, e nada é gravado.
3. Grave, quando o plano estiver certo: o mesmo comando com `-Aplicar`. O
   script mostra o plano de novo e pede confirmação.
4. Quando os tablets reais estiverem funcionando, aposente a homologação:
   `-Aplicar -AposentarHomologacao`. Os `*-HOM-*` ficam inativos (e os
   aparelhos revogados), mas não são apagados: casos e trilha apontam para
   eles. **As contas de teste deixam de entrar**, porque usam
   `APAR-HOM-0001` e `APAR-HOM-0005`.

Rodar de novo com a mesma planilha não muda nada. Com a planilha atualizada,
entram só as diferenças. Um aparelho revogado (perdido, roubado) não é
reativado por planilha: isso é decisão à parte, feita no banco.
