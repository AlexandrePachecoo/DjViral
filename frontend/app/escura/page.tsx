import { getLocale, getTranslations } from "next-intl/server";
import styles from "./page.module.css";
import LangSwitch from "../_landing/LangSwitch";

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
const CONTACT_HREF = "mailto:contato@djviral.com.br";

export default async function Landing() {
  const t = await getTranslations("escura");
  const locale = await getLocale();
  const paidCtaHref = locale === "en" ? CONTACT_HREF : TRIAL_HREF;

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
              {t("nav.howItWorks")}
            </a>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#precos">
              {t("nav.pricing")}
            </a>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="/login">
              {t("nav.login")}
            </a>
            <a className={styles.navCta} href={TRIAL_HREF}>
              {t("nav.tryFree")}
            </a>
            <LangSwitch className={`${styles.navLink} ${styles.navLinksText}`} />
          </div>
        </nav>

        {/* hero */}
        <section className={styles.hero}>
          <div>
            <div className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              {t("hero.eyebrow")}
            </div>
            <h1 className={styles.h1}>
              {t("hero.titlePrefix")}{" "}
              <span className={styles.gradientText}>{t("hero.titleHighlight")}</span>
              {t("hero.titleSuffix")}
            </h1>
            <p className={styles.sub}>{t("hero.subtitle")}</p>
            <div className={styles.heroButtons}>
              <a className={styles.btnPrimary} href={TRIAL_HREF}>
                {t("hero.primaryCta")}
              </a>
              <a className={styles.btnGhost} href="#como-funciona">
                {t("hero.secondaryCta")}
              </a>
            </div>
            <div className={styles.microcopy}>{t("hero.microcopy")}</div>
            <div className={styles.stats}>
              <div>
                <div className={styles.statNum}>3h</div>
                <div className={styles.statLabel}>{t("hero.stat1")}</div>
              </div>
              <div>
                <div className={styles.statNum}>30</div>
                <div className={styles.statLabel}>{t("hero.stat2")}</div>
              </div>
              <div>
                <div className={styles.statNum}>9:16</div>
                <div className={styles.statLabel}>{t("hero.stat3")}</div>
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
                  <span className={styles.cardTitle}>{t("card.analyzing")}</span>
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
                <span className={styles.cardPillText}>{t("card.momentsFound")}</span>
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
          <div className={styles.sectionEyebrow}>{t("how.eyebrow")}</div>
          <h2 className={styles.howTitle}>{t("how.title")}</h2>
          <div className={styles.steps}>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ backgroundImage: "linear-gradient(120deg,#a855f7,#ec4899)" }}
              >
                01
              </div>
              <h3 className={styles.stepTitle}>{t("how.step1.title")}</h3>
              <p className={styles.stepBody}>{t("how.step1.body")}</p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ backgroundImage: "linear-gradient(120deg,#d946ef,#22d3ee)" }}
              >
                02
              </div>
              <h3 className={styles.stepTitle}>{t("how.step2.title")}</h3>
              <p className={styles.stepBody}>{t("how.step2.body")}</p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ backgroundImage: "linear-gradient(120deg,#22d3ee,#a855f7)" }}
              >
                03
              </div>
              <h3 className={styles.stepTitle}>{t("how.step3.title")}</h3>
              <p className={styles.stepBody}>{t("how.step3.body")}</p>
            </div>
          </div>
        </section>

        {/* preços */}
        <section id="precos" className={styles.pricing}>
          <div className={styles.pricingHead}>
            <div className={styles.pricingUnderline}>
              <span />
            </div>
            <div className={styles.sectionEyebrow}>{t("pricing.eyebrow")}</div>
            <h2 className={styles.pricingTitle}>{t("pricing.title")}</h2>
          </div>
          <div className={styles.plans}>
            <div className={styles.plan}>
              <div className={styles.planName}>{t("pricing.free.name")}</div>
              <div className={styles.planPrice}>R$0</div>
              <div className={styles.planSub}>{t("pricing.free.sub")}</div>
              <div className={styles.planFeatures}>
                <span>✓ {t("pricing.free.feature1")}</span>
                <span>✓ {t("pricing.free.feature2")}</span>
                <span>✓ {t("pricing.free.feature3")}</span>
                <span className={styles.featureMuted}>· {t("pricing.free.feature4")}</span>
              </div>
              <a className={styles.planCtaGhost} href={TRIAL_HREF}>
                {t("pricing.free.cta")}
              </a>
            </div>
            <div className={`${styles.plan} ${styles.planPro}`}>
              <span className={styles.planBadge}>{t("pricing.popularBadge")}</span>
              <div className={styles.planName}>{t("pricing.pro.name")}</div>
              <div className={styles.planPrice}>
                R$39,90<span className={styles.planPriceUnit}>{t("pricing.perMonth")}</span>
              </div>
              <div className={styles.planSub}>{t("pricing.paymentSub")}</div>
              <div className={`${styles.planFeatures} ${styles.planFeaturesPro}`}>
                <span>✓ {t("pricing.pro.feature1")}</span>
                <span>✓ {t("pricing.pro.feature2")}</span>
                <span>✓ {t("pricing.pro.feature3")}</span>
                <span>✓ {t("pricing.pro.feature4")}</span>
              </div>
              <a className={styles.planCtaFill} href={paidCtaHref}>
                {locale === "en" ? t("pricing.contactCta") : t("pricing.pro.cta")}
              </a>
            </div>
            <div className={styles.plan}>
              <div className={styles.planName}>{t("pricing.premium.name")}</div>
              <div className={styles.planPrice}>
                R$59,90<span className={styles.planPriceUnit}>{t("pricing.perMonth")}</span>
              </div>
              <div className={styles.planSub}>{t("pricing.paymentSub")}</div>
              <div className={styles.planFeatures}>
                <span>✓ {t("pricing.premium.feature1")}</span>
                <span>✓ {t("pricing.premium.feature2")}</span>
                <span>✓ {t("pricing.premium.feature3")}</span>
                <span>✓ {t("pricing.premium.feature4")}</span>
              </div>
              <a className={styles.planCtaGhost} href={paidCtaHref}>
                {locale === "en" ? t("pricing.contactCta") : t("pricing.premium.cta")}
              </a>
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className={styles.ctaFinal}>
          <h2 className={styles.ctaTitle}>{t("finalCta.title")}</h2>
          <p className={styles.ctaSub}>{t("finalCta.subtitle")}</p>
          <a className={styles.ctaButton} href={TRIAL_HREF}>
            {t("hero.primaryCta")}
          </a>
        </section>

        {/* footer */}
        <footer className={styles.footer}>
          <span className={styles.footerLogo}>
            <span className="wmDj">DJ</span>
            <span className="wmViral">viral</span>
          </span>
          <span className={styles.footerCopy}>{t("footer.copy")}</span>
        </footer>
      </div>
    </div>
  );
}
