import { getLocale, getTranslations } from "next-intl/server";
import styles from "./page.module.css";
import Generator from "./_landing/Generator";
import BeforeAfter from "./_landing/BeforeAfter";
import LangSwitch from "./_landing/LangSwitch";
import { PLANS, priceLabel } from "@/lib/plans";

const EQ_COLORS = ["#a855f7", "#d946ef", "#ec4899", "#22d3ee"];
const TRIAL_HREF = "/login";
const SIGNUP_HREF = "/login?signup=1";

function Check() {
  return (
    <svg className={styles.check} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill="currentColor" opacity="0.14" />
      <path
        d="M4.6 8.3l2.2 2.2 4.6-4.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Ícones dos recursos (traço, 24px) — um path por recurso, na ordem f1..f6.
const FEATURE_ICONS = [
  // ondas de áudio
  "M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4",
  // enquadramento / zoom
  "M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0",
  // texto / gancho
  "M5 6h14M5 6v2M19 6v2M12 6v13M9 19h6",
  // sliders do editor
  "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  // link
  "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  // compartilhar
  "M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5",
];

const FEATURE_KEYS = ["f1", "f2", "f3", "f4", "f5", "f6"] as const;
const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;
const STAT_KEYS = ["1", "2", "3", "4"] as const;
const PLATFORM_NAMES = ["TikTok", "Instagram Reels", "YouTube Shorts"];

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

export default async function Landing() {
  const t = await getTranslations("landing");
  const locale = await getLocale();
  // Preços por locale: USD (Stripe) no internacional, BRL (AbacatePay) no BR.
  // Ambos os planos pagos levam ao cadastro; o checkout acontece dentro do app.
  const proPrice = priceLabel(PLANS.pro, locale);
  const premiumPrice = priceLabel(PLANS.premium, locale);
  const freePrice = locale === "en" ? "$0" : "R$0";

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
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#recursos">
              {t("nav.features")}
            </a>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#como-funciona">
              {t("nav.howItWorks")}
            </a>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#precos">
              {t("nav.pricing")}
            </a>
            <a className={`${styles.navLink} ${styles.navLinksText}`} href="#faq">
              {t("nav.faq")}
            </a>
            <span className={`${styles.navDivider} ${styles.navLinksText}`} />
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
          <div className={styles.heroCopy}>
            <div className={styles.heroBadge}>
              <span className={styles.heroBadgeDot} />
              {t("hero.badge")}
            </div>
            <h1 className={styles.h1}>
              {t("hero.titleLine1")}
              <br />
              <span className={styles.gradientText}>{t("hero.titleLine2")}</span>
            </h1>
            <p className={styles.sub}>{t("hero.subtitle")}</p>
            <div className={styles.heroCtas}>
              <a className={styles.heroCtaPrimary} href={SIGNUP_HREF}>
                {t("hero.ctaPrimary")}
                <span aria-hidden="true">→</span>
              </a>
              <a className={styles.heroCtaGhost} href="#como-funciona">
                {t("hero.ctaSecondary")}
              </a>
            </div>
            <ul className={styles.heroTrust}>
              <li><Check />{t("hero.trust1")}</li>
              <li><Check />{t("hero.trust2")}</li>
              <li><Check />{t("hero.trust3")}</li>
            </ul>
          </div>

          <div className={styles.heroGen}>
            <Generator />
          </div>
        </section>

        {/* plataformas + números do produto */}
        <section className={styles.proof}>
          <div className={styles.platforms}>
            <span className={styles.platformsLabel}>{t("platforms.label")}</span>
            {PLATFORM_NAMES.map((p) => (
              <span key={p} className={styles.platformChip}>
                {p}
              </span>
            ))}
          </div>
          <div className={styles.stats}>
            {STAT_KEYS.map((k) => (
              <div key={k} className={styles.stat}>
                <div className={styles.statValue}>{t(`stats.v${k}`)}</div>
                <div className={styles.statLabel}>{t(`stats.s${k}`)}</div>
              </div>
            ))}
          </div>
        </section>

        {/* antes → depois */}
        <BeforeAfter />

        {/* recursos */}
        <section id="recursos" className={styles.features}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>{t("features.eyebrow")}</div>
            <h2 className={styles.howTitle}>{t("features.title")}</h2>
            <p className={styles.sectionSub}>{t("features.subtitle")}</p>
          </div>
          <div className={styles.featureGrid}>
            {FEATURE_KEYS.map((k, i) => (
              <div key={k} className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={FEATURE_ICONS[i]} />
                  </svg>
                </div>
                <h3 className={styles.featureTitle}>{t(`features.${k}.title`)}</h3>
                <p className={styles.featureBody}>{t(`features.${k}.body`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* como funciona */}
        <section id="como-funciona" className={styles.howSection}>
          <div className={styles.howHead}>
            <div className={styles.sectionEyebrow}>{t("how.eyebrow")}</div>
            <h2 className={styles.howTitle}>{t("how.title")}</h2>
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
              <h3 className={styles.stepTitle}>{t("how.step1.title")}</h3>
              <p className={styles.stepBody}>{t("how.step1.body")}</p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ background: "linear-gradient(135deg,#d946ef,#ec4899)" }}
              >
                2
              </div>
              <h3 className={styles.stepTitle}>{t("how.step2.title")}</h3>
              <p className={styles.stepBody}>{t("how.step2.body")}</p>
            </div>
            <div className={styles.stepCard}>
              <div
                className={styles.stepNum}
                style={{ background: "linear-gradient(135deg,#ec4899,#22d3ee)" }}
              >
                3
              </div>
              <h3 className={styles.stepTitle}>{t("how.step3.title")}</h3>
              <p className={styles.stepBody}>{t("how.step3.body")}</p>
            </div>
          </div>
        </section>

        {/* preços */}
        <section id="precos" className={styles.pricing}>
          <div className={styles.pricingHead}>
            <div className={styles.sectionEyebrow}>{t("pricing.eyebrow")}</div>
            <h2 className={styles.pricingTitle}>{t("pricing.title")}</h2>
          </div>
          <div className={styles.plans}>
            <div className={styles.plan}>
              <div className={styles.planName}>{t("pricing.free.name")}</div>
              <div className={styles.planPrice}>{freePrice}</div>
              <div className={styles.planSub}>{t("pricing.free.sub")}</div>
              <div className={styles.planFeatures}>
                <span><Check />{t("pricing.free.feature1")}</span>
                <span><Check />{t("pricing.free.feature2")}</span>
                <span><Check />{t("pricing.free.feature3")}</span>
              </div>
              <a className={styles.planCtaGhost} href={TRIAL_HREF}>
                {t("pricing.free.cta")}
              </a>
            </div>
            <div className={`${styles.plan} ${styles.planPro}`}>
              <span className={styles.planBadge}>{t("pricing.popularBadge")}</span>
              <div className={styles.planName}>{t("pricing.pro.name")}</div>
              <div className={styles.planPrice}>
                {proPrice}<span className={styles.planPriceUnit}>{t("pricing.perMonth")}</span>
              </div>
              <div className={styles.planSub}>{t("pricing.paymentSub")}</div>
              <div className={`${styles.planFeatures} ${styles.planFeaturesPro}`}>
                <span><Check />{t("pricing.pro.feature1")}</span>
                <span><Check />{t("pricing.pro.feature2")}</span>
                <span><Check />{t("pricing.pro.feature3")}</span>
                <span><Check />{t("pricing.pro.feature4")}</span>
              </div>
              <a className={styles.planCtaFill} href={TRIAL_HREF}>
                {t("pricing.pro.cta")}
              </a>
            </div>
            <div className={styles.plan}>
              <div className={styles.planName}>{t("pricing.premium.name")}</div>
              <div className={styles.planPrice}>
                {premiumPrice}<span className={styles.planPriceUnit}>{t("pricing.perMonth")}</span>
              </div>
              <div className={styles.planSub}>{t("pricing.paymentSub")}</div>
              <div className={styles.planFeatures}>
                <span><Check />{t("pricing.premium.feature1")}</span>
                <span><Check />{t("pricing.premium.feature2")}</span>
                <span><Check />{t("pricing.premium.feature3")}</span>
                <span><Check />{t("pricing.premium.feature4")}</span>
              </div>
              <a className={styles.planCtaGhost} href={TRIAL_HREF}>
                {t("pricing.premium.cta")}
              </a>
            </div>
          </div>
          <p className={styles.pricingNote}>{t("pricing.note")}</p>
        </section>

        {/* FAQ */}
        <section id="faq" className={styles.faq}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionEyebrow}>{t("faq.eyebrow")}</div>
            <h2 className={styles.howTitle}>{t("faq.title")}</h2>
          </div>
          <div className={styles.faqList}>
            {FAQ_KEYS.map((k, i) => (
              <details key={k} className={styles.faqItem} open={i === 0}>
                <summary className={styles.faqQ}>
                  {t(`faq.${k}.q`)}
                  <span className={styles.faqChevron} aria-hidden="true" />
                </summary>
                <p className={styles.faqA}>{t(`faq.${k}.a`)}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA final */}
        <section className={styles.ctaFinal}>
          <h2 className={styles.ctaTitle}>{t("finalCta.title")}</h2>
          <p className={styles.ctaSub}>{t("finalCta.subtitle")}</p>
          <a className={styles.ctaButton} href="#gerador">
            {t("finalCta.button")}
          </a>
          <div className={styles.ctaMicro}>{t("hero.trust1")} · {t("hero.trust2")}</div>
        </section>

        {/* footer */}
        <footer className={styles.footer}>
          <div className={styles.footerTop}>
            <div className={styles.footerBrand}>
              <Logo />
              <p className={styles.footerTagline}>{t("footer.tagline")}</p>
            </div>
            <div className={styles.footerCol}>
              <span className={styles.footerColTitle}>{t("footer.product")}</span>
              <a href="#gerador">{t("nav.tryNow")}</a>
              <a href="#recursos">{t("nav.features")}</a>
              <a href="#como-funciona">{t("nav.howItWorks")}</a>
              <a href="#precos">{t("nav.pricing")}</a>
              <a href="#faq">{t("nav.faq")}</a>
            </div>
            <div className={styles.footerCol}>
              <span className={styles.footerColTitle}>{t("footer.account")}</span>
              <a href="/login">{t("nav.login")}</a>
              <a href={SIGNUP_HREF}>{t("footer.signup")}</a>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span className={styles.footerCopy}>{t("footer.copy")}</span>
            <span className={styles.footerCopy}>{PLATFORM_NAMES.join(" · ")}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
