"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./landing.module.css";

const GRAD_PAIRS: [string, string][] = [
  ["#a855f7", "#22d3ee"],
  ["#d946ef", "#ec4899"],
  ["#7c3aed", "#a855f7"],
  ["#ec4899", "#22d3ee"],
];

const PLATFORMS = ["tiktok", "instagram", "youtube", "tiktok", "youtube"] as const;
const AB_DURS = ["0:15", "0:22", "0:18", "0:20", "0:16"];

const SEQUENCE = [
  { step: 0, t: 700 },
  { step: 1, t: 850 },
  { step: 2, t: 650 },
  { step: 3, t: 450 },
  { step: 4, t: 200 },
  { step: 5, t: 200 },
  { step: 6, t: 200 },
  { step: 7, t: 200 },
  { step: 8, t: 2400 },
];

const SET_WAVE = Array.from({ length: 64 }, (_, i) => {
  const v = Math.abs(
    Math.sin(i * 0.45) * 0.6 + Math.sin(i * 0.21) * 0.4 + Math.sin(i * 0.9) * 0.25
  );
  return { h: `${24 + Math.round(v * 68)}%`, d: `${((i * 0.04) % 1.2).toFixed(2)}s` };
});

function TiktokIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff">
      <path d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.2v12.9a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4.02.6.07V8.32a5.7 5.7 0 0 0-.6-.03A5.66 5.66 0 1 0 15.6 13.9V8.63a7.5 7.5 0 0 0 4.4 1.4V6.83a4.28 4.28 0 0 1-3.4-1.01z" />
    </svg>
  );
}

function InstaIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="#fff" stroke="none" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24">
      <path
        d="M23 12s0-3.5-.44-5.17a2.6 2.6 0 0 0-1.83-1.84C19.06 4.55 12 4.55 12 4.55s-7.06 0-8.73.44A2.6 2.6 0 0 0 1.44 6.83C1 8.5 1 12 1 12s0 3.5.44 5.17a2.6 2.6 0 0 0 1.83 1.84c1.67.44 8.73.44 8.73.44s7.06 0 8.73-.44a2.6 2.6 0 0 0 1.83-1.84C23 15.5 23 12 23 12z"
        fill="#fff"
      />
      <path d="M9.9 15.3l6-3.3-6-3.3z" fill="#0d0d12" />
    </svg>
  );
}

const PLATFORM_ICON = {
  tiktok: TiktokIcon,
  instagram: InstaIcon,
  youtube: YoutubeIcon,
};

export default function BeforeAfter() {
  const [step, setStep] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let i = 0;
    const tick = () => {
      setStep(SEQUENCE[i].step);
      timeoutRef.current = setTimeout(() => {
        i = (i + 1) % SEQUENCE.length;
        tick();
      }, SEQUENCE[i].t);
    };
    tick();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const imgShown = step >= 1;
  const cursorTransform =
    step >= 2
      ? step === 3
        ? "translate(-6px,10px) scale(.9)"
        : "translate(-6px,4px)"
      : "translate(66px,52px)";
  const btnTransform = step < 1 ? "translateY(14px) scale(.9)" : step === 3 ? "scale(.94)" : "none";
  const btnShadow = step === 3 ? 0.2 : 0.38;
  const shownCount = step >= 4 ? Math.min(5, step - 3) : 0;

  return (
    <section className={styles.abSection}>
      <div className={styles.abHead}>
        <div className={styles.sectionEyebrow}>ANTES → DEPOIS</div>
        <h2 className={styles.abTitle}>De um set gigante a um feed inteiro.</h2>
      </div>

      <div className={styles.abWrap}>
        <div className={styles.abCard}>
          <div className={styles.abVideoWrap}>
            <div
              data-anim={imgShown ? "" : undefined}
              className={`${styles.abVideo} ${imgShown ? styles.abVideoShown : ""}`}
            >
              <span className={styles.abVideoTag}>SEU SET · 2:47:11</span>
              <div className={styles.abVideoWave}>
                {SET_WAVE.map((b, i) => (
                  <span
                    key={i}
                    data-anim
                    className={styles.abWaveBar}
                    style={{ height: b.h, animationDelay: b.d }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className={styles.abButtonRow}>
            <span
              className={styles.abButton}
              style={{
                transform: btnTransform,
                opacity: imgShown ? 1 : 0,
                boxShadow: `0 12px 30px rgba(217,70,239,${btnShadow})`,
              }}
            >
              ✂ Gerar cortes
            </span>
            <div className={styles.abCursor} style={{ transform: cursorTransform }}>
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="#18181b"
                stroke="#fff"
                strokeWidth="1.4"
                strokeLinejoin="round"
              >
                <path d="M5 2.5l14.5 7.4-6.1 1.4 3.3 6.5-2.9 1.4-3.3-6.5L5 18z" />
              </svg>
            </div>
          </div>

          <div className={styles.abClipsGrid}>
            {PLATFORMS.map((p, i) => {
              const shown = i < shownCount;
              const [a, b] = GRAD_PAIRS[i % GRAD_PAIRS.length];
              const Icon = PLATFORM_ICON[p];
              const transform = shown
                ? "none"
                : `translate(${(2 - i) * 48}px, -74px) rotate(${(i - 2) * 8}deg) scale(.8)`;
              return (
                <div
                  key={i}
                  className={styles.abClip}
                  style={{
                    backgroundImage: `linear-gradient(160deg, ${a}cc, ${b}cc), url('/images/dj-preview.webp')`,
                    opacity: shown ? 1 : 0,
                    transform,
                  }}
                >
                  <span className={styles.abClipIcon}>
                    <Icon />
                  </span>
                  <span className={styles.abClipDur}>{AB_DURS[i]}</span>
                </div>
              );
            })}
          </div>

          <div className={styles.abFoot}>
            Um clique transforma o set inteiro em cortes prontos pra TikTok, Reels e Shorts.
          </div>
        </div>
      </div>
    </section>
  );
}
