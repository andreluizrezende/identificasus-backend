/**
 * O usuário de teste único que `keycloak-fake.ts` (credencial) e
 * `semear-ambiente-local.ts` (cadastro em `mob_usuario`) precisam concordar
 * sem se falar em tempo de execução — por isso mora num arquivo à parte, sem
 * nenhum efeito colateral de importar (nem servidor, nem conexão de banco).
 */
export const USUARIO_DE_TESTE = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'andre.teste@identificasus.local',
  senha: 'CampoSamu2027!Ba',
  nome: 'Equipe de teste (local)',
  purpose: 'ASSISTENCIAL',
};
