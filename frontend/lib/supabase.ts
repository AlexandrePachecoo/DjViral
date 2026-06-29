import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente Supabase server-side. Usa a service role key — só pode ser importado
// em route handlers / código de servidor, NUNCA em componentes client.
//
// A criação é preguiçosa (lazy): as env vars só são exigidas quando o cliente é
// de fato usado (em runtime), não ao importar o módulo. Isso evita quebrar o
// build da Vercel (a coleta de page data importa este módulo) quando as
// variáveis não estão presentes no ambiente de build.

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidos no ambiente"
    );
  }
  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// Proxy que cria o cliente real no primeiro acesso. Mantém a API
// `supabaseAdmin.from(...)` intacta para quem importa.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const real = getClient();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const SOURCES_BUCKET = process.env.SUPABASE_SOURCES_BUCKET ?? "sources";
export const CLIPS_BUCKET = process.env.SUPABASE_BUCKET ?? "clips";
