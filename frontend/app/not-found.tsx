import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Página não encontrada · DJviral",
  description: "Esse endereço não existe na DJviral.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "48px 20px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 440 }}>
        <p style={{ margin: 0, letterSpacing: "0.14em", fontSize: 13, opacity: 0.6 }}>404</p>
        <h1 style={{ margin: "12px 0 8px", fontSize: 36, letterSpacing: "-0.03em" }}>
          Página não encontrada
        </h1>
        <p style={{ margin: 0, lineHeight: 1.5, opacity: 0.8 }}>
          Esse endereço não existe ou foi movido. Volte para a página inicial e envie o seu set.
        </p>
        <a
          href="/"
          style={{
            display: "inline-block",
            marginTop: 22,
            padding: "12px 22px",
            borderRadius: 999,
            background: "#7c3aed",
            color: "#fff",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Voltar para a home
        </a>
      </div>
    </main>
  );
}
