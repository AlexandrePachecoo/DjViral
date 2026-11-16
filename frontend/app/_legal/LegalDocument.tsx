import type { ReactNode } from "react";
import type { LegalDoc } from "./copy";
import styles from "./legal.module.css";

function RichText({ value }: { value: string }) {
  const parts = value.split(/(\[[^[\]]+\])/g);
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("[") && part.endsWith("]")) {
      nodes.push(
        <mark key={i} className={styles.placeholder}>
          {part}
        </mark>
      );
      return;
    }
    // Links internos escritos como "/privacidade" ou "/termos" no texto.
    const bits = part.split(/(\/privacidade|\/termos)/g);
    bits.forEach((bit, j) => {
      if (bit === "/privacidade" || bit === "/termos") {
        nodes.push(
          <a key={`${i}-${j}`} href={bit}>
            {bit}
          </a>
        );
      } else if (bit) {
        nodes.push(<span key={`${i}-${j}`}>{bit}</span>);
      }
    });
  });
  return <>{nodes}</>;
}

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a className={styles.brand} href="/">
          <span className="wmDj">DJ</span>
          <span className="wmViral">viral</span>
        </a>
        <nav className={styles.topLinks}>
          <a href="/privacidade">Privacidade</a>
          <a href="/termos">Termos</a>
        </nav>
      </header>
      <article className={styles.article}>
        <p className={styles.kicker}>DJviral</p>
        <h1>{doc.title}</h1>
        <p className={styles.updated}>{doc.updated}</p>
        <p className={styles.draft}>{doc.draftNote}</p>
        {doc.sections.map((section) => (
          <section key={section.heading} className={styles.section}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>
                <RichText value={paragraph} />
              </p>
            ))}
          </section>
        ))}
      </article>
      <footer className={styles.footer}>
        <a href="/">Home</a>
        <a href="/privacidade">Política de Privacidade</a>
        <a href="/termos">Termos de Uso</a>
      </footer>
    </div>
  );
}
