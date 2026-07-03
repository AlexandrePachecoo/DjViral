import { NextResponse } from "next/server";
import { supabaseAdmin, CLIPS_BUCKET, SOURCES_BUCKET } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { clipPathFromUrl, removeFolder } from "@/lib/storage";

// Descarta os cortes não salvos do usuário. Roda no mount do estúdio, então
// "recarregar a página" limpa tudo que ficou sem ser salvo:
//   - projeto SEM nenhum corte salvo  → apaga o set inteiro (clipes + vídeo
//     original no Storage + o projeto, que via `on delete cascade` leva junto
//     `cuts` e `sources`).
//   - projeto COM cortes salvos       → apaga só os cortes não salvos (linhas
//     em `cuts` + os arquivos de clipe correspondentes).
// Só toca projetos `done` — nunca um que ainda está processando.
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "done");

  let deletedSets = 0;
  let deletedCuts = 0;

  for (const project of projects ?? []) {
    const { data: cuts } = await supabaseAdmin
      .from("cuts")
      .select("id, url, saved")
      .eq("project_id", project.id);

    const all = cuts ?? [];
    const hasSaved = all.some((c) => c.saved);

    if (!hasSaved) {
      // Nenhum corte salvo: apaga o set inteiro (Storage + projeto).
      await removeFolder(CLIPS_BUCKET, project.id);
      await removeFolder(SOURCES_BUCKET, project.id);
      await supabaseAdmin.from("projects").delete().eq("id", project.id);
      deletedSets += 1;
      continue;
    }

    // Tem cortes salvos: remove só os não salvos (arquivos + linhas).
    const unsaved = all.filter((c) => !c.saved);
    if (unsaved.length === 0) continue;

    const clipPaths = unsaved
      .map((c) => clipPathFromUrl(c.url))
      .filter((p): p is string => p !== null);
    if (clipPaths.length > 0) {
      await supabaseAdmin.storage.from(CLIPS_BUCKET).remove(clipPaths);
    }
    await supabaseAdmin
      .from("cuts")
      .delete()
      .in("id", unsaved.map((c) => c.id));
    deletedCuts += unsaved.length;
  }

  return NextResponse.json({ deletedSets, deletedCuts });
}
