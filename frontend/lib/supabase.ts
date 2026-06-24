import { createClient } from "@supabase/supabase-js";

// Cliente Supabase server-side. Usa a service role key — só pode ser importado
// em route handlers / código de servidor, NUNCA em componentes client.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidos no ambiente"
  );
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const SOURCES_BUCKET = process.env.SUPABASE_SOURCES_BUCKET ?? "sources";
export const CLIPS_BUCKET = process.env.SUPABASE_BUCKET ?? "clips";
