# Pendências

## `npm run test:banco` não roda nesta máquina

**Situação (checada em 2026-09-10):**

- Docker não está instalado (`docker: command not found`), então o serviço
  `mysql` do `docker-compose.yml` nunca foi de fato subido aqui.
- A porta `3306` já está ocupada por **outro** MySQL, rodando fora de Docker,
  alheio a este projeto — ele não tem o usuário `nri_migracao` (nem os demais
  `nri_*`) com a senha esperada (`trocar`):

  ```
  Error: Access denied for user 'nri_migracao'@'localhost' (using password: YES)
  ```

Os testes de banco (`test/banco/*.banco.test.ts`) esperam o schema `dbsamu` com
os usuários por finalidade do ADR-14 (`nri_migracao`, `nri_assistencial`,
`nri_auditoria`), provisionados pelos scripts em `db/` — ver `test/banco/apoio.ts`.

**Para retomar, duas opções:**

1. **Instalar Docker** e subir o `mysql` do `docker-compose.yml` do projeto
   (isolado do MySQL que já ocupa a `3306` — ajustar a porta exposta ou parar
   o outro serviço primeiro).
2. **Usar o MySQL local existente**: aplicar os scripts de `db/` nele e criar
   os usuários `nri_migracao`, `nri_assistencial`, `nri_auditoria` com os
   grants do ADR-14.

Depois de qualquer uma das duas, `npm run test:banco` (ou
`npx vitest run --config vitest.banco.config.ts`) deve passar.
