import styles from "./page.module.css";
import Generator from "./_landing/Generator";
import BeforeAfter from "./_landing/BeforeAfter";

const EQ_COLORS = ["#a855f7", "#d946ef", "#ec4899", "#22d3ee"];
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

export default function Landing() {
  return (
    <div className={styles.page}>
      <div className={styles.glowTop} />
      <div className={styles.glowLeft} />
      <div className={styles.glowRight} />

      <div className={styles.shell}>
        {/* nav */}
        <nav className={styles.nav}>
          <Logo />
          <div className={styles.navLinks}>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#gerador">
              Testar agora
            </a>
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
              Teste grátis
            </a>
          </div>
        </nav>

        {/* hero */}
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1 className={styles.h1}>
              1 set longo.
              <br />
              <span className={styles.gradientText}>30 cortes virais.</span>
            </h1>
            <p className={styles.sub}>
              Suba o vídeo do seu set. A IA acha os drops, as viradas e os
              momentos de maior energia&nbsp; e devolve vídeos verticais
              prontos pro feed.
            </p>
          </div>

          <div className={styles.heroGen}>
            <Generator />
          </div>
        </section>

        {/* antes → depois */}
        <BeforeAfter />

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
                style={{ background: "linear-gradient(135deg,#a855f7,#d946ef)" }}
              >
                1
              </div>
              <h3 className={styles.stepTitle}>Envie seu set</h3>
              <p className={styles.stepBody}>
                Arraste o vídeo do seu set de até 3 horas
              </p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ background: "linear-gradient(135deg,#d946ef,#ec4899)" }}
              >
                2
              </div>
              <h3 className={styles.stepTitle}>A IA corta os picos</h3>
              <p className={styles.stepBody}>
                Detectamos drops, viradas e os momentos de maior energia e
                cortamos automaticamente&nbsp; sem você rever tudo.
              </p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ background: "linear-gradient(135deg,#ec4899,#22d3ee)" }}
              >
                3
              </div>
              <h3 className={styles.stepTitle}>Receba 30 cortes</h3>
              <p className={styles.stepBody}>
                Vídeos verticais 9:16, prontos para postar no TikTok, Reels e
                Shorts. Ainda tem a opção de editar o corte do jeito que
                quiser&nbsp;
              </p>
            </div>
          </div>
        </section>

        {/* preços */}
        <section id="precos" className={styles.pricing}>
          <div className={styles.pricingHead}>
            <div className={styles.sectionEyebrow}>PREÇOS</div>
            <h2 className={styles.pricingTitle}>
              Comece grátis. Cresça quando bombar.
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
            Seu próximo set já tem 30 cortes esperando.
          </h2>
          <p className={styles.ctaSub}>
            Suba um set agora e veja a DJviral cortar 1 hora em 10 clipes —
            de graça.
          </p>
          <a className={styles.ctaButton} href="#gerador">
            Testar grátis agora
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
