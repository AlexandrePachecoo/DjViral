// Origem pública usada em canonical, Open Graph, robots e sitemap.
// APP_URL já existe no projeto (retorno do checkout). Sem ela, o domínio
// de produção é o fallback — não inventamos outro host.
export function siteUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "https://www.djviral.com.br";
}
