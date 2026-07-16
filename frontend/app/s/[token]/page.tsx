import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPublicShare } from "@/lib/share";
import { toStudioCut, downloadUrl } from "@/app/app/_studio/cut";
import { theme, font, scoreColor } from "@/app/app/_studio/theme";

// Página PÚBLICA de um set compartilhado (/s/<token>). Fica FORA de app/app/,
// então não herda o guard de sessão — qualquer pessoa acessa sem login. Server
// component: busca direto no banco (service role) e renderiza. O player e o
// download usam só HTML nativo, então não precisa de "use client".
export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations("publicShare");
  const share = await getPublicShare(params.token);
  if (!share) return { title: t("metadata.notFoundTitle") };
  return {
    title: `${share.setName} · DJviral`,
    description: share.message || t("metadata.description", { setName: share.setName }),
  };
}

export default async function PublicSetPage({ params }: Props) {
  const t = await getTranslations("publicShare");
  const share = await getPublicShare(params.token);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.bg,
        color: theme.textPrimary,
        fontFamily: font.body,
      }}
    >
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px 80px" }}>
        {/* Wordmark */}
        <div style={{ font: `600 18px ${font.wordmark}`, letterSpacing: "-.02em", marginBottom: 28 }}>
          DJ<span style={{ color: theme.accent }}>viral</span>
        </div>

        {!share ? (
          <div
            style={{
              padding: "56px 24px",
              textAlign: "center",
              borderRadius: 14,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              color: theme.textMuted,
              fontSize: 15,
            }}
          >
            {t("notFound")}
          </div>
        ) : (
          <>
            {/* Nome do set */}
            <h1 style={{ font: `600 30px ${font.display}`, letterSpacing: "-.02em", margin: "0 0 6px" }}>
              {share.setName}
            </h1>
            <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: share.message ? 24 : 34 }}>
              {t("cutsCount", { count: share.cuts.length })}
            </div>

            {/* Mensagem do dono */}
            {share.message && (
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: 14,
                  background: theme.accentSoft,
                  border: `1px solid ${theme.accentBorder}`,
                  color: theme.textSecondary2,
                  fontSize: 15,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  marginBottom: 34,
                }}
              >
                {share.message}
              </div>
            )}

            {/* Cortes */}
            {share.cuts.length === 0 ? (
              <div
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  borderRadius: 14,
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  color: theme.textMuted,
                  fontSize: 14,
                }}
              >
                {t("noCuts")}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(224px,1fr))", gap: 20 }}>
                {share.cuts.map(toStudioCut).map((cut) => (
                  <div
                    key={cut.id}
                    style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: "hidden", background: theme.surface }}
                  >
                    <div style={{ position: "relative", background: "#000" }}>
                      <video
                        src={cut.url}
                        controls
                        playsInline
                        preload="metadata"
                        style={{ width: "100%", height: 270, objectFit: "cover", display: "block", background: "#000" }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 13,
                          right: 14,
                          font: `600 15px ${font.display}`,
                          color: scoreColor(cut.score),
                          background: "rgba(255,255,255,.85)",
                          padding: "2px 7px",
                          borderRadius: 7,
                          pointerEvents: "none",
                        }}
                      >
                        {cut.score}
                      </div>
                    </div>
                    <div style={{ padding: 14 }}>
                      <div style={{ font: `500 14px ${font.display}`, marginBottom: 6 }}>{cut.title}</div>
                      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>
                        {cut.dur} · {t("inSet")} · {cut.moment}
                      </div>
                      <a
                        href={downloadUrl(cut)}
                        target="_blank"
                        rel="noopener"
                        style={{
                          display: "block",
                          textAlign: "center",
                          padding: 9,
                          borderRadius: 8,
                          fontSize: 13,
                          color: theme.textSecondary,
                          background: theme.surface,
                          border: `1px solid ${theme.borderStrong}`,
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t("download")}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Rodapé / CTA */}
            <div style={{ marginTop: 48, paddingTop: 24, borderTop: `1px solid ${theme.border}`, fontSize: 13, color: theme.textMuted }}>
              {t("footer.prefix")}{" "}
              <a href="/" style={{ color: theme.accent, textDecoration: "none", fontWeight: 500 }}>
                DJviral
              </a>
              .
            </div>
          </>
        )}
      </main>
    </div>
  );
}
