"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./landing.module.css";

type Phase = "idle" | "analyzing" | "done";

const LABELS = [
  "carregando áudio…",
  "detectando drops e viradas…",
  "medindo energia da pista…",
  "escolhendo os melhores momentos…",
  "cortando em 9:16…",
];

const GRAD_PAIRS: [string, string][] = [
  ["#a855f7", "#22d3ee"],
  ["#d946ef", "#ec4899"],
  ["#7c3aed", "#a855f7"],
  ["#ec4899", "#22d3ee"],
];

const DURS = ["0:15", "0:22", "0:18", "0:20", "0:16", "0:24", "0:19", "0:21"];
const SCORES = [94, 91, 89, 96, 87, 92, 85, 90];

function buildClips() {
  return DURS.map((dur, i) => {
    const [a, b] = GRAD_PAIRS[i % GRAD_PAIRS.length];
    return {
      dur,
      score: SCORES[i],
      n: String(i + 1).padStart(2, "0"),
      grad: `linear-gradient(160deg, ${a}cc, ${b}cc)`,
      delay: `${i * 0.11}s`,
    };
  });
}

function buildWave(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(
      Math.sin(i * 0.5) * 0.6 + Math.sin(i * 0.17) * 0.4 + Math.sin(i * 1.1) * 0.22
    );
    return { h: `${20 + Math.round(v * 76)}%`, d: `${((i * 0.05) % 1.1).toFixed(2)}s` };
  });
}

const ANALYZE_WAVE = buildWave(44);
const CLIPS = buildClips();
const IDLE_BARS = [
  { color: "#a855f7", h: "60%", d: "0s" },
  { color: "#d946ef", h: "100%", d: ".15s" },
  { color: "#ec4899", h: "45%", d: ".3s" },
  { color: "#7c3aed", h: "85%", d: ".45s" },
  { color: "#22d3ee", h: "55%", d: ".6s" },
];

export default function Generator() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const progressRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function run(name: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    progressRef.current = 0;
    setPhase("analyzing");
    setProgress(0);
    setFileName(name);
    timerRef.current = setInterval(() => {
      progressRef.current += 2.5 + Math.random() * 4.5;
      if (progressRef.current >= 100) {
        if (timerRef.current) clearInterval(timerRef.current);
        setProgress(100);
        setPhase("done");
      } else {
        setProgress(progressRef.current);
      }
    }, 95);
  }

  function reset() {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase("idle");
    setProgress(0);
    setFileName("");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0];
    if (f) run(f.name);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    run(f ? f.name : "seu-set.mp4");
  }

  const pct = Math.min(100, Math.round(progress));
  const labelIndex = Math.min(LABELS.length - 1, Math.floor((pct / 100) * LABELS.length));

  return (
    <div id="gerador" className={styles.genCard}>
      <div className={styles.genHead}>
        <span className={styles.genHeadText}>Gerador de cortes</span>
      </div>

      <div className={styles.genBody}>
        {phase === "idle" && (
          <label
            htmlFor="djv-file"
            onDragOver={onDragOver}
            onDrop={onDrop}
            className={styles.dropzone}
          >
            <div className={styles.idleBars}>
              {IDLE_BARS.map((b, i) => (
                <span
                  key={i}
                  data-anim
                  className={styles.idleBar}
                  style={{ background: b.color, height: b.h, animationDelay: b.d }}
                />
              ))}
            </div>
            <div className={styles.dropTitle}>Arraste o vídeo do seu set aqui</div>
            <div className={styles.dropHint}>
              MP4 · até 3 horas · o arquivo não sai do seu navegador
            </div>
            <span className={styles.dropCta}>Selecionar arquivo e testar grátis</span>
            <input
              id="djv-file"
              type="file"
              accept="video/*"
              onChange={onFile}
              className={styles.hiddenInput}
            />
          </label>
        )}

        {phase === "analyzing" && (
          <div className={styles.analyzing}>
            <div className={styles.analyzingHead}>
              <span className={styles.analyzingDot} data-anim />
              <span className={styles.analyzingLabel}>analisando · {fileName}</span>
            </div>
            <div className={styles.analyzeWave}>
              {ANALYZE_WAVE.map((bar, i) => (
                <span
                  key={i}
                  data-anim
                  className={styles.analyzeBar}
                  style={{ height: bar.h, animationDelay: bar.d }}
                />
              ))}
            </div>
            <div className={styles.progressWrap}>
              <div className={styles.progressRow}>
                <span className={styles.progressLabel}>{LABELS[labelIndex]}</span>
                <span className={styles.progressPct}>{pct}%</span>
              </div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div>
            <div className={styles.doneHead}>
              <div className={styles.doneHeadLeft}>
                <span className={styles.doneScissors}>✂</span>
                <span className={styles.doneTitle}>30 cortes gerados</span>
                <span className={styles.doneFileName}>de {fileName}</span>
              </div>
              <span className={styles.doneChip}>✦ 4 momentos com score 90+</span>
            </div>

            <div className={styles.clipsGrid}>
              {CLIPS.map((clip) => (
                <div
                  key={clip.n}
                  data-anim
                  className={styles.clipCard}
                  style={{ animationDelay: clip.delay }}
                >
                  <div
                    className={styles.clipThumb}
                    style={{
                      backgroundImage: `${clip.grad}, url('/images/dj-preview.webp')`,
                    }}
                  >
                    <span className={styles.clipPlay}>▶</span>
                    <span className={styles.clipDur}>{clip.dur}</span>
                    <span className={styles.clipScoreBadge}>{clip.score}</span>
                  </div>
                  <div className={styles.clipFoot}>
                    <span className={styles.clipLabel}>Corte {clip.n}</span>
                    <span>📱</span>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.doneActions}>
              <a className={styles.dlButton} href="/login">
                ↓ Baixar os 30 cortes
              </a>
              <button type="button" onClick={reset} className={styles.resetButton}>
                ↺ Testar outro set
              </button>
            </div>
            <div className={styles.doneMicro}>
              No plano Pro os 30 cortes saem legendados e em alta resolução.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
