"use client";

import { useState } from "react";
import styles from "./landing.module.css";

type Phase = "idle" | "form" | "gate";
type CutStyle = "basic" | "dynamic";

const SIGNUP_HREF = "/login?signup=1";
// No teste grátis o plano permite até 10 cortes por set.
const FREE_MAX_CUTS = 10;

const IDLE_BARS = [
  { color: "#a855f7", h: "60%", d: "0s" },
  { color: "#d946ef", h: "100%", d: ".15s" },
  { color: "#ec4899", h: "45%", d: ".3s" },
  { color: "#7c3aed", h: "85%", d: ".45s" },
  { color: "#22d3ee", h: "55%", d: ".6s" },
];

const STYLE_OPTIONS: { id: CutStyle; title: string; desc: string }[] = [
  { id: "basic", title: "Corte seco", desc: "Enquadramento fixo no centro. Mais rápido." },
  { id: "dynamic", title: "Corte dinâmico", desc: "Zoom no DJ e no público, no ritmo da batida." },
];

// Deriva um nome de set a partir do arquivo (tira a extensão).
function nameFromFile(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "").slice(0, 80);
}

export default function Generator() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [cutStyle, setCutStyle] = useState<CutStyle>("basic");
  const [numCuts, setNumCuts] = useState(FREE_MAX_CUTS);

  function loadFile(file: string) {
    setFileName(file);
    setName(nameFromFile(file));
    setPhase("form");
  }

  function reset() {
    setPhase("idle");
    setFileName("");
    setName("");
    setCutStyle("basic");
    setNumCuts(FREE_MAX_CUTS);
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

  function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPhase("gate");
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

        {phase === "form" && (
          <form className={styles.form} onSubmit={onGenerate}>
            <div className={styles.loadedFileRow}>
              <span className={styles.loadedCheck}>✓</span>
              <div className={styles.loadedFileInfo}>
                <span className={styles.loadedFileName}>{fileName}</span>
                <span className={styles.loadedFileMeta}>set carregado</span>
              </div>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="djv-name">
                Nome do set
              </label>
              <input
                id="djv-name"
                type="text"
                className={styles.textInput}
                placeholder="Ex.: Set verão 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </div>

            <div className={styles.formField}>
              <span className={styles.formLabel}>Estilo de corte</span>
              <div
                className={styles.styleGrid}
                role="radiogroup"
                aria-label="Estilo de corte"
              >
                {STYLE_OPTIONS.map((opt) => {
                  const active = cutStyle === opt.id;
                  return (
                    <div
                      key={opt.id}
                      role="radio"
                      aria-checked={active}
                      tabIndex={0}
                      onClick={() => setCutStyle(opt.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setCutStyle(opt.id);
                        }
                      }}
                      className={`${styles.styleCard} ${active ? styles.styleCardActive : ""}`}
                    >
                      <span className={styles.styleCardTitle}>{opt.title}</span>
                      <span className={styles.styleCardDesc}>{opt.desc}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.formField}>
              <div className={styles.formLabelRow}>
                <span className={styles.formLabel}>Quantidade de cortes</span>
                <span className={styles.formValue}>{numCuts}</span>
              </div>
              <input
                type="range"
                className={styles.rangeInput}
                min={1}
                max={FREE_MAX_CUTS}
                value={numCuts}
                onChange={(e) => setNumCuts(Number(e.target.value))}
                aria-label="Quantidade de cortes"
              />
              <div className={styles.fieldHint}>
                No teste grátis, até {FREE_MAX_CUTS} cortes por set.
              </div>
            </div>

            <button type="submit" className={styles.generateBtn} disabled={!name.trim()}>
              ✂ Gerar cortes
            </button>
            <button type="button" className={styles.changeFileBtn} onClick={reset}>
              Trocar arquivo
            </button>
          </form>
        )}

        {phase === "gate" && (
          <div className={styles.gate}>
            <span className={styles.gateSpark}>✦</span>
            <div className={styles.gateTitle}>Crie sua conta pra gerar os cortes</div>
            <p className={styles.gateText}>
              É grátis — a IA vai cortar <strong>{name || fileName}</strong> em{" "}
              {numCuts} vídeo{numCuts > 1 ? "s" : ""} vertica{numCuts > 1 ? "is" : "l"} 9:16
              prontos pro feed.
            </p>
            <a className={styles.gateCta} href={SIGNUP_HREF}>
              Criar conta grátis
            </a>
            <button type="button" className={styles.gateBack} onClick={() => setPhase("form")}>
              ← Voltar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
