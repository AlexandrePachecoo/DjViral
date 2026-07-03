import { supabaseAdmin, CLIPS_BUCKET } from "@/lib/supabase";

// Extrai o caminho do objeto dentro do bucket `clips` a partir da URL pública
// gravada em cuts.url. O worker sobe os clipes com `get_public_url`, gerando
// algo como `.../storage/v1/object/public/clips/<project_id>/clipe_...mp4`
// (às vezes com `?` no fim). Devolve `<project_id>/clipe_...mp4` ou null.
export function clipPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/public/${CLIPS_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  let path = url.slice(idx + marker.length);
  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q);
  path = path.replace(/\/$/, "");
  return decodeURIComponent(path) || null;
}

// Remove todos os arquivos de um "prefixo" (pasta lógica) de um bucket. O
// Supabase Storage não tem delete recursivo: lista o conteúdo do prefixo e
// remove em lote. Usado para apagar tudo de um projeto (`<project_id>/`).
export async function removeFolder(bucket: string, prefix: string): Promise<void> {
  const { data: files } = await supabaseAdmin.storage.from(bucket).list(prefix);
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${prefix}/${f.name}`);
  await supabaseAdmin.storage.from(bucket).remove(paths);
}
