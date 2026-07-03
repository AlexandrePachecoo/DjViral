import styles from "./page.module.css";

// Deterministic waveform bars (layered sines) so the equalizers read like a
// real audio waveform instead of random noise. `h` = base height, `d` = delay.
const wave = Array.from({ length: 56 }, (_, i) => {
  const v = Math.abs(
    Math.sin(i * 0.5) * 0.6 + Math.sin(i * 0.17) * 0.4 + Math.sin(i * 1.1) * 0.22
  );
  return { h: 14 + Math.round(v * 92), d: +((i * 0.05) % 1.1).toFixed(2) };
});

const waveBg = Array.from({ length: 30 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 0.6 + 1) * 0.7 + Math.sin(i * 0.23) * 0.4);
  return { h: 34 + Math.round(v * 130), d: +((i * 0.08) % 1.1).toFixed(2) };
});

const markers = Array.from({ length: 14 }, (_, i) => ({
  h: 5 + Math.round(Math.abs(Math.sin(i * 0.9)) * 15),
  d: +((i * 0.09) % 1.1).toFixed(2),
}));

const EQ_COLORS = ["#a855f7", "#d946ef", "#ec4899", "#22d3ee"];

function Logo({ className }: { className: string }) {
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
      <span className={className}>
        <span className="wmDj">DJ</span>
        <span className="wmViral">viral</span>
      </span>
    </div>
  );
}

const TRIAL_HREF = "/login";

export default function Landing() {
  return (
    <div className={styles.page}>
      <div className={styles.glowTop} data-anim />
      <div className={styles.glowBottom} />

      <div className={styles.shell}>
        {/* nav */}
        <nav className={styles.nav}>
          <Logo className={styles.wordmark} />
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
              Testar grátis
            </a>
          </div>
        </nav>

        {/* hero */}
        <section className={styles.hero}>
          <div>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              FEITO PRA DJS QUE QUEREM BOMBAR
            </div>
            <h1 className={styles.h1}>
              Seu set vira{" "}
              <span className={styles.gradientText}>30 cortes virais</span>. Sem
              editar nada.
            </h1>
            <p className={styles.sub}>
              Suba um set de até 3 horas. A DJviral encontra os melhores momentos
              e te entrega 30 vídeos verticais prontos pro TikTok e Reels.
            </p>
            <div className={styles.heroButtons}>
              <a className={styles.btnPrimary} href={TRIAL_HREF}>
                Testar grátis — 1h vira 10 cortes
              </a>
              <a className={styles.btnGhost} href="#como-funciona">
                ▸ Ver como funciona
              </a>
            </div>
            <div className={styles.microcopy}>
              Sem cartão de crédito · Primeiros cortes em minutos
            </div>
            <div className={styles.stats}>
              <div>
                <div className={styles.statNum}>3h</div>
                <div className={styles.statLabel}>de set por upload</div>
              </div>
              <div>
                <div className={styles.statNum}>30</div>
                <div className={styles.statLabel}>cortes prontos</div>
              </div>
              <div>
                <div className={styles.statNum}>9:16</div>
                <div className={styles.statLabel}>vertical pra postar</div>
              </div>
            </div>
          </div>

          {/* analyzer visual */}
          <div className={styles.analyzerWrap}>
            <div className={styles.ambientWave} aria-hidden="true">
              {waveBg.map((b, i) => (
                <div
                  key={i}
                  className={`${styles.ambientBar} ${styles.wvb}`}
                  data-anim
                  style={{ height: `${b.h}px`, animationDelay: `${b.d}s` }}
                />
              ))}
            </div>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderLeft}>
                  <span className={styles.cardDot} />
                  <span className={styles.cardTitle}>
                    analisando · set-verão.mp3
                  </span>
                </div>
                <span className={styles.cardTime}>2:47:11</span>
              </div>
              <div className={styles.cardWave} aria-hidden="true">
                {wave.map((b, i) => (
                  <div
                    key={i}
                    className={`${styles.cardBar} ${styles.wvb}`}
                    data-anim
                    style={{ height: `${b.h}px`, animationDelay: `${b.d}s` }}
                  />
                ))}
              </div>
              <div className={styles.cardPill}>
                <span className={styles.cardPillText}>
                  ✦ 30 momentos virais encontrados
                </span>
                <span className={styles.markers} aria-hidden="true">
                  {markers.map((m, i) => (
                    <span
                      key={i}
                      className={`${styles.markerBar} ${styles.wvb}`}
                      data-anim
                      style={{ height: `${m.h}px`, animationDelay: `${m.d}s` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* como funciona */}
        <section id="como-funciona" className={styles.howSection}>
          <div className={styles.howBar} />
          <div className={styles.sectionEyebrow}>COMO FUNCIONA</div>
          <h2 className={styles.howTitle}>Do arquivo ao feed em 3 passos.</h2>
          <div className={styles.steps}>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ backgroundImage: "linear-gradient(120deg,#a855f7,#ec4899)" }}
              >
                01
              </div>
              <h3 className={styles.stepTitle}>Suba seu set</h3>
              <p className={styles.stepBody}>
                Arraste um arquivo de até 3 horas ou cole o link do SoundCloud,
                YouTube ou Mixcloud.
              </p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ backgroundImage: "linear-gradient(120deg,#d946ef,#22d3ee)" }}
              >
                02
              </div>
              <h3 className={styles.stepTitle}>A IA acha os picos</h3>
              <p className={styles.stepBody}>
                Detectamos drops, viradas e os momentos de maior energia da pista
                — sem você ouvir tudo de novo.
              </p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ backgroundImage: "linear-gradient(120deg,#22d3ee,#a855f7)" }}
              >
                03
              </div>
              <h3 className={styles.stepTitle}>Receba 30 cortes</h3>
              <p className={styles.stepBody}>
                Vídeos verticais 9:16, já legendados e prontos pra postar no
                TikTok e Reels.
              </p>
            </div>
          </div>
        </section>

        {/* preços */}
        <section id="precos" className={styles.pricing}>
          <div className={styles.pricingHead}>
            <div className={styles.pricingUnderline}>
              <span />
            </div>
            <div className={styles.sectionEyebrow}>PREÇOS</div>
            <h2 className={styles.pricingTitle}>
              Comece grátis. Cresça quando bombar.
            </h2>
          </div>
          <div className={styles.plans}>
            <div className={styles.plan}>
              <div className={styles.planName}>Teste grátis</div>
              <div className={styles.planPrice}>R$0</div>
              <div className={styles.planSub}>pra experimentar</div>
              <div className={styles.planFeatures}>
                <span>✓ 1 hora de set pra testar</span>
                <span>✓ 10 cortes verticais 9:16</span>
                <span>✓ Análise automática dos drops</span>
                <span className={styles.featureMuted}>· Sem cartão de crédito</span>
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
              <div className={styles.planSub}>PIX ou cartão · renova todo mês</div>
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
              <div className={styles.planSub}>PIX ou cartão · renova todo mês</div>
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
            Seus melhores drops não merecem morrer no SoundCloud.
          </h2>
          <p className={styles.ctaSub}>
            Suba um set agora e veja a DJviral transformar 1 hora em 10 cortes —
            de graça.
          </p>
          <a className={styles.ctaButton} href={TRIAL_HREF}>
            Testar grátis — 1h vira 10 cortes
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
