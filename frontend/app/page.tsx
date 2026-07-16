import { getLocale, getTranslations } from "next-intl/server";
import styles from "./page.module.css";
import Generator from "./_landing/Generator";
import BeforeAfter from "./_landing/BeforeAfter";
import LangSwitch from "./_landing/LangSwitch";

const EQ_COLORS = ["#a855f7", "#d946ef", "#ec4899", "#22d3ee"];
const TRIAL_HREF = "/login";
const CONTACT_HREF = "mailto:contato@djviral.com.br";

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
  const paidCtaHref = locale === "en" ? CONTACT_HREF : TRIAL_HREF;

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
              {t("nav.tryNow")}
            </a>
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
          <div className={styles.heroCopy}>
            <h1 className={styles.h1}>
              {t("hero.titleLine1")}
              <br />
              <span className={styles.gradientText}>{t("hero.titleLine2")}</span>
            </h1>
            <p className={styles.sub}>{t("hero.subtitle")}</p>
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
              <div className={styles.planPrice}>R$0</div>
              <div className={styles.planSub}>{t("pricing.free.sub")}</div>
              <div className={styles.planFeatures}>
                <span>✓ {t("pricing.free.feature1")}</span>
                <span>✓ {t("pricing.free.feature2")}</span>
                <span>✓ {t("pricing.free.feature3")}</span>
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
          <a className={styles.ctaButton} href="#gerador">
            {t("finalCta.button")}
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
