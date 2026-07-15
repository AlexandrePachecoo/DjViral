"use client";

import { useState } from "react";
import styles from "./landing.module.css";

type Phase = "idle" | "loaded" | "gate";

const SIGNUP_HREF = "/login?signup=1";

// Waveform determinística (senoides sobrepostas) p/ o preview do set carregado.
const PREVIEW_WAVE = Array.from({ length: 56 }, (_, i) => {
  const v = Math.abs(
    Math.sin(i * 0.5) * 0.6 + Math.sin(i * 0.17) * 0.4 + Math.sin(i * 1.1) * 0.22
  );
  return { h: `${20 + Math.round(v * 76)}%`, d: `${((i * 0.05) % 1.1).toFixed(2)}s` };
});

const IDLE_BARS = [
  { color: "#a855f7", h: "60%", d: "0s" },
  { color: "#d946ef", h: "100%", d: ".15s" },
  { color: "#ec4899", h: "45%", d: ".3s" },
  { color: "#7c3aed", h: "85%", d: ".45s" },
  { color: "#22d3ee", h: "55%", d: ".6s" },
];

export default function Generator() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");

  function loadFile(name: string) {
    setFileName(name);
    setPhase("loaded");
  }

  function reset() {
    setPhase("idle");
    setFileName("");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f.name);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(f ? f.name : "seu-set.mp4");
  }

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

        {phase === "loaded" && (
          <div className={styles.loaded}>
            <div className={styles.loadedFileRow}>
              <span className={styles.loadedCheck}>✓</span>
              <div className={styles.loadedFileInfo}>
                <span className={styles.loadedFileName}>{fileName}</span>
                <span className={styles.loadedFileMeta}>set carregado · pronto pra cortar</span>
              </div>
            </div>

            <div className={styles.loadedPreview}>
              <span className={styles.loadedPreviewTag}>SEU SET</span>
              <div className={styles.loadedWave}>
                {PREVIEW_WAVE.map((bar, i) => (
                  <span
                    key={i}
                    data-anim
                    className={styles.loadedWaveBar}
                    style={{ height: bar.h, animationDelay: bar.d }}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              className={styles.generateBtn}
              onClick={() => setPhase("gate")}
            >
              ✂ Gerar 30 cortes
            </button>
            <button type="button" className={styles.changeFileBtn} onClick={reset}>
              Trocar arquivo
            </button>
          </div>
        )}

        {phase === "gate" && (
          <div className={styles.gate}>
            <span className={styles.gateSpark}>✦</span>
            <div className={styles.gateTitle}>Crie sua conta pra gerar os cortes</div>
            <p className={styles.gateText}>
              É grátis — a IA vai cortar <strong>{fileName}</strong> em até 30 vídeos
              verticais 9:16 prontos pro feed.
            </p>
            <a className={styles.gateCta} href={SIGNUP_HREF}>
              Criar conta grátis
            </a>
            <button type="button" className={styles.gateBack} onClick={() => setPhase("loaded")}>
              ← Voltar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
