import styles from "./page.module.css";

// Deterministic waveform bars (layered sines) so the timeline reads like a
// real audio waveform instead of random noise.
const timelineWave = Array.from({ length: 80 }, (_, i) => {
  const v = Math.abs(
    Math.sin(i * 0.5) * 0.6 + Math.sin(i * 0.17) * 0.4 + Math.sin(i * 1.1) * 0.22
  );
  const h = 22 + Math.round(v * 74);
  return { h, d: +((i * 0.035) % 1.2).toFixed(2) };
});

const EQ_COLORS = ["#a855f7", "#d946ef", "#ec4899", "#22d3ee"];

const SET_NAME = "set-verao-2026.mp4";
const TRIAL_HREF = "/login";

function Logo() {
  return (
    <div className={styles.logo}>
      <div className={styles.eq}>
        {EQ_COLORS.map((c, i) => (
          <span
            key={c}
            className={styles.eqbar}
            data-anim
            style={{ background: c, animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <span className={styles.wordmark}>
        <span className="wmDj">DJ</span>
        <span className="wmViral">viral</span>
      </span>
    </div>
  );
}

const CUTS = [
  { cls: styles.cut1, left: "20%", label: "✂ 0:42" },
  { cls: styles.cut2, left: "44%", label: "✂ 1:15" },
  { cls: styles.cut3, left: "66%", label: "✂ 1:58" },
  { cls: styles.cut4, left: "85%", label: "✂ 2:31" },
];

const CLIPS = [
  { cls: styles.clip1, grad: "linear-gradient(160deg,#a855f7,#d946ef)", border: "rgba(168,85,247,.6)", shadow: "rgba(124,58,237,.45)", dur: "0:15", n: "01", score: "94" },
  { cls: styles.clip2, grad: "linear-gradient(160deg,#d946ef,#ec4899)", border: "rgba(217,70,239,.6)", shadow: "rgba(217,70,239,.45)", dur: "0:22", n: "02", score: "91" },
  { cls: styles.clip3, grad: "linear-gradient(160deg,#ec4899,#22d3ee)", border: "rgba(236,72,153,.6)", shadow: "rgba(236,72,153,.45)", dur: "0:18", n: "03", score: "89" },
  { cls: styles.clip4, grad: "linear-gradient(160deg,#22d3ee,#a855f7)", border: "rgba(34,211,238,.6)", shadow: "rgba(34,211,238,.45)", dur: "0:20", n: "04", score: "96" },
];

const SEGMENTS = [
  { left: "20%", width: "24%", grad: "linear-gradient(180deg,rgba(168,85,247,.4),rgba(217,70,239,.2))" },
  { left: "44%", width: "22%", grad: "linear-gradient(180deg,rgba(236,72,153,.4),rgba(34,211,238,.2))" },
  { left: "66%", width: "19%", grad: "linear-gradient(180deg,rgba(34,211,238,.4),rgba(168,85,247,.2))" },
];

export default function LandingClaro() {
  return (
    <div className={styles.page}>
      <div className={styles.glowTop} />

      <div className={styles.shell}>
        {/* nav */}
        <nav className={styles.nav}>
          <Logo />
          <div className={styles.navLinks}>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#como-funciona">
              Como funciona
            </a>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#precos">
              Preços
            </a>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="/login">
              Entrar
            </a>
            <a className={styles.navCta} href={TRIAL_HREF}>
              Assinar Pro
            </a>
          </div>
        </nav>

        {/* hero */}
        <section className={styles.hero}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowDot} />
            CORTES AUTOMÁTICOS COM IA
          </div>
          <h1 className={styles.h1}>
            Transforme seu set em{" "}
            <span className={styles.gradientText}>30 cortes virais</span> sem
            editar nada.
          </h1>
          <p className={styles.sub}>
            Envie o vídeo do seu set. A IA encontra os melhores momentos e
            corta tudo em vídeos verticais 9:16 legendados, prontos para o
            feed.
          </p>
          <div className={styles.heroButtons}>
            <a className={styles.btnPrimary} href="#precos">
              Assinar Pro — R$39,90/mês
            </a>
            <a className={styles.btnGhost} href="#como-funciona">
              ▸ Ver como funciona
            </a>
          </div>
          <div className={styles.microcopy}>
            Cancele quando quiser · Primeiros cortes em minutos
          </div>
        </section>

        {/* editor — animação de corte */}
        <section className={styles.editorSection}>
          <div className={styles.editorCard}>
            <div className={styles.editorHead}>
              <div className={styles.editorHeadLeft}>
                <span className={styles.editorDot} />
                <span className={styles.editorTitle}>
                  cortando · {SET_NAME}
                </span>
              </div>
              <div className={styles.editorHeadRight}>
                <span className={styles.editorTime}>2:47:11</span>
                <span className={styles.editorAiChip}>IA</span>
              </div>
            </div>

            <div className={styles.cutZone}>
              {/* preview */}
              <div className={styles.preview}>
                <div className={styles.previewOverlay} />
                <div className={styles.playBadge} data-anim>
                  <span className={styles.playGlyph}>▶</span>
                </div>
                <div className={styles.previewLabel}>
                  <span className={styles.previewDot} />
                  <span className={styles.previewLabelText}>
                    1:58 / 2:47:11 · analisando energia
                  </span>
                </div>
              </div>

              {/* timeline */}
              <div className={styles.timeline}>
                <div className={styles.timelineOverlay} />
                {SEGMENTS.map((s, i) => (
                  <div
                    key={i}
                    className={styles.segment}
                    data-anim
                    style={{ left: s.left, width: s.width, background: s.grad }}
                  />
                ))}
                <div className={styles.waveform}>
                  {timelineWave.map((b, i) => (
                    <span
                      key={i}
                      className={styles.wfBar}
                      data-anim
                      style={{ height: `${b.h}%`, animationDelay: `${b.d}s` }}
                    />
                  ))}
                </div>
              </div>

              {/* playhead sweeping preview + timeline */}
              <div className={styles.playhead} data-anim />

              {/* cut markers */}
              {CUTS.map((c, i) => (
                <div
                  key={i}
                  className={`${styles.cut} ${c.cls}`}
                  data-anim
                  style={{ left: c.left }}
                >
                  <span className={styles.cutLine} />
                  <span className={styles.cutTag}>{c.label}</span>
                  <span className={styles.cutDot} />
                </div>
              ))}
            </div>

            {/* extracted vertical clips */}
            <div className={styles.clipsRow}>
              {CLIPS.map((c, i) => (
                <div
                  key={i}
                  className={`${styles.clip} ${c.cls}`}
                  data-anim
                  style={{
                    borderColor: c.border,
                    boxShadow: `0 14px 30px -8px ${c.shadow}`,
                  }}
                >
                  <div className={styles.clipThumb} style={{ background: c.grad }}>
                    <span className={styles.playGlyphSm}>▶</span>
                    <span className={styles.clipDur}>{c.dur}</span>
                  </div>
                  <div className={styles.clipFoot}>
                    <span className={styles.clipLabel}>Corte {c.n}</span>
                    <span className={styles.clipScore}>{c.score}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.editorFoot}>
              <span className={styles.editorFootText} data-anim>
                ✂ 30 cortes verticais 9:16 exportados
              </span>
            </div>
          </div>
        </section>

        {/* como funciona */}
        <section id="como-funciona" className={styles.howSection}>
          <div className={styles.howHead}>
            <div className={styles.sectionEyebrow}>COMO FUNCIONA</div>
            <h2 className={styles.howTitle}>
              Do arquivo ao feed em três passos.
            </h2>
          </div>
          <div className={styles.steps}>
            <div className={styles.stepsLine} />
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ background: "linear-gradient(120deg,#a855f7,#ec4899)" }}
              >
                1
              </div>
              <h3 className={styles.stepTitle}>Envie seu set</h3>
              <p className={styles.stepBody}>
                Arraste o vídeo de até 3 horas ou cole o link do YouTube,
                SoundCloud ou Mixcloud.
              </p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ background: "linear-gradient(120deg,#d946ef,#22d3ee)" }}
              >
                2
              </div>
              <h3 className={styles.stepTitle}>A IA corta os picos</h3>
              <p className={styles.stepBody}>
                Detectamos drops, viradas e os momentos de maior energia e
                cortamos automaticamente — sem você rever tudo.
              </p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ background: "linear-gradient(120deg,#22d3ee,#a855f7)" }}
              >
                3
              </div>
              <h3 className={styles.stepTitle}>Receba 30 cortes</h3>
              <p className={styles.stepBody}>
                Vídeos verticais 9:16, já legendados e prontos para postar no
                TikTok, Reels e Shorts.
              </p>
            </div>
          </div>
        </section>

        {/* preços */}
        <section id="precos" className={styles.pricing}>
          <div className={styles.pricingHead}>
            <div className={styles.sectionEyebrow}>PREÇOS</div>
            <h2 className={styles.pricingTitle}>
              Comece grátis. Cresça quando precisar.
            </h2>
          </div>
          <div className={styles.plans}>
            <div className={styles.plan}>
              <div className={styles.planName}>Teste grátis</div>
              <div className={styles.planPrice}>R$0</div>
              <div className={styles.planSub}>para experimentar</div>
              <div className={styles.planFeatures}>
                <span>✓ 1 hora de set para testar</span>
                <span>✓ 10 cortes verticais 9:16</span>
                <span>✓ Cortes automáticos dos drops</span>
              </div>
              <a className={styles.planCtaGhost} href={TRIAL_HREF}>
                Começar grátis
              </a>
            </div>
            <div className={`${styles.plan} ${styles.planPro}`}>
              <span className={styles.planBadge}>★ MAIS POPULAR</span>
              <div className={styles.planName}>Pro</div>
              <div className={styles.planPrice}>
                R$39,90<span className={styles.planPriceUnit}>/mês</span>
              </div>
              <div className={styles.planSub}>
                PIX ou cartão · renova todo mês
              </div>
              <div className={`${styles.planFeatures} ${styles.planFeaturesPro}`}>
                <span>✓ Até 5 horas de set por mês</span>
                <span>✓ Sets de até 3 horas</span>
                <span>✓ Até 30 cortes por set</span>
                <span>✓ Re-corte no minuto exato</span>
              </div>
              <a className={styles.planCtaFill} href={TRIAL_HREF}>
                Assinar Pro
              </a>
            </div>
            <div className={styles.plan}>
              <div className={styles.planName}>Premium</div>
              <div className={styles.planPrice}>
                R$59,90<span className={styles.planPriceUnit}>/mês</span>
              </div>
              <div className={styles.planSub}>
                PIX ou cartão · renova todo mês
              </div>
              <div className={styles.planFeatures}>
                <span>✓ Até 12 horas de set por mês</span>
                <span>✓ Sets de até 3 horas</span>
                <span>✓ Até 30 cortes por set</span>
                <span>✓ Re-corte no minuto exato</span>
              </div>
              <a className={styles.planCtaGhost} href={TRIAL_HREF}>
                Assinar Premium
              </a>
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className={styles.ctaFinal}>
          <h2 className={styles.ctaTitle}>
            Comece a publicar hoje. Seu set já tem os cortes.
          </h2>
          <p className={styles.ctaSub}>
            Envie um set agora e veja a DJviral cortar 1 hora em 10 clipes —
            de graça.
          </p>
          <a className={styles.ctaButton} href="#precos">
            Assinar Pro — R$39,90/mês
          </a>
        </section>

        {/* footer */}
        <footer className={styles.footer}>
          <span className={styles.footerLogo}>
            <span className="wmDj">DJ</span>
            <span className="wmViral">viral</span>
          </span>
          <span className={styles.footerCopy}>
            © 2026 DJviral · cortes que viram feed
          </span>
        </footer>
      </div>
    </div>
  );
}
