/**
 * Convencao de caminho no store `identificasus-fotos`: `casos/<coCaso>/<uuid>.<ext>`.
 * O `coCaso` no caminho é o que mantem o bucket organizado por caso e evita
 * escrita fora do prefixo esperado; o uuid evita colisao sem precisar do
 * `addRandomSuffix` do Blob (que mudaria o nome depois do cliente ja tê-lo
 * calculado para o hash em `esquemaConteudoMidia`).
 */
export const CAMINHO_DE_FOTO =
  /^casos\/[A-Za-z0-9_-]{1,20}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;

export function caminhoDeFotoValido(pathname: string): boolean {
  return CAMINHO_DE_FOTO.test(pathname);
}

/** Espelha `tpMidia: 'IMG'` de sincronizacao.esquemas — este store e so de fotos. */
export const TIPOS_DE_FOTO_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

/** Foto de aparelho de campo; generoso o bastante pra nao recusar camera boa. */
export const TAMANHO_MAXIMO_DA_FOTO_EM_BYTES = 15 * 1024 * 1024;
