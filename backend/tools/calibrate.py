"""Relatório de calibração do corte dinâmico a partir de um set REAL.

Roda a mesma análise do worker (áudio → janelas candidatas → visual → shot
plan) num vídeo local, sem Supabase e sem renderizar clipes, e mostra por
janela os números que os knobs ``VISUAL_*`` / ``DYNAMIC_*`` olham. Serve para
ajustar os defaults com sets de balada (pouca luz, laser) em vez de no chute.

    cd backend
    python -m tools.calibrate set.mp4                  # tabela no terminal
    python -m tools.calibrate set.mp4 --top 15 --json relatorio.json

Variáveis de ambiente continuam valendo, então dá para comparar um ajuste sem
editar código:

    DYNAMIC_MIN_SHOT_CONF=0.2 python -m tools.calibrate set.mp4

Como ler:
- ``escuro``  — janela tratada como pouca luz (CLAHE ligado). Se quase tudo
  sai escuro num set bem iluminado (ou o contrário), o limiar
  ``VISUAL_LOW_LIGHT_LUMA_THRESHOLD`` está fora.
- ``dj%``     — persistência da track do DJ. Baixa em set escuro = o YOLO está
  perdendo o DJ (olhar ``VISUAL_LOW_LIGHT_CLAHE_CLIP`` e o limiar acima).
- ``mov``/``vis`` — score de movimento e score visual da janela (0-1).
- colunas ``subtle/medium/intense`` — shots do plano em cada intensidade, no
  formato ``total:dj/dançarino/público/wide+center``. Plano quase só de
  wide/center numa janela com gente = a guarda de presença
  (``DYNAMIC_MIN_SHOT_COVERAGE`` / ``DYNAMIC_MIN_SHOT_CONF``) ou o respiro
  reativo (``DYNAMIC_STILL_ACTIVITY_*``) estão derrubando os zooms.
"""
import argparse
import json
import statistics
import sys
import time

from app import analyzer, dynamic, visual
from app.config import settings
from app.pipeline import probe_duration, probe_video

INTENSITIES = ("subtle", "medium", "intense")


def _shot_summary(shots: list[dynamic.Shot]) -> dict:
    kinds = [s.kind for s in shots]
    return {
        "shots": len(shots),
        "dj": kinds.count("dj"),
        "dancer": kinds.count("dancer"),
        "crowd": kinds.count("crowd"),
        "wide": kinds.count("wide") + kinds.count("center"),
    }


def analyze_set(path: str, top: int) -> dict:
    duration = probe_duration(path)
    dims = probe_video(path)
    t0 = time.monotonic()
    peaks, bpm = analyzer.analyze(path, top_n=top)
    audio_seconds = time.monotonic() - t0

    net = visual.load_model()
    net_face = visual.load_face_model()
    windows = []
    t0 = time.monotonic()
    for peak in sorted(peaks, key=lambda p: p.start_sec):
        start = max(0.0, peak.start_sec - settings.pre_roll)
        clip = float(settings.clip_duration)
        row: dict = {"start": round(start, 1), "score_musical": round(peak.score, 3)}
        try:
            wv = visual.analyze_window(
                path, start, clip, net=net,
                detect_every=settings.visual_detect_every,
                fps=settings.visual_fps, net_face=net_face,
            )
        except Exception as exc:  # noqa: BLE001 - relatório segue sem a janela
            row["error"] = f"{type(exc).__name__}: {exc}"
            windows.append(row)
            continue
        row.update(
            low_light=wv.low_light,
            detected=wv.detected,
            dj_found=wv.dj_box is not None,
            dj_track_ratio=round(wv.dj_track_ratio, 2) if wv.dj_box else 0.0,
            dancer_found=wv.dancer_box is not None,
            crowd_found=wv.crowd_box is not None,
            presence_ratio=round(wv.presence_ratio, 2),
            motion_score=round(wv.motion_score, 3),
            visual_score=round(wv.visual_score, 3),
        )
        beats = visual.get_beat_times(path, start, clip, bpm)
        row["beats"] = len(beats)
        row["plans"] = {}
        for level in INTENSITIES:
            shots = dynamic.build_shot_plan(
                wv, beats, clip, dims["width"], dims["height"],
                peak_at=peak.start_sec - start, intensity=level,
            )
            row["plans"][level] = _shot_summary(shots)
        windows.append(row)
    visual_seconds = time.monotonic() - t0

    ok = [w for w in windows if "error" not in w]
    summary = {
        "windows": len(windows),
        "errors": len(windows) - len(ok),
        "low_light_share": round(sum(w["low_light"] for w in ok) / len(ok), 2) if ok else None,
        "dj_found_share": round(sum(w["dj_found"] for w in ok) / len(ok), 2) if ok else None,
        "dj_track_ratio_median": round(
            statistics.median(w["dj_track_ratio"] for w in ok), 2
        ) if ok else None,
        "visual_score_median": round(
            statistics.median(w["visual_score"] for w in ok), 3
        ) if ok else None,
        "audio_seconds": round(audio_seconds, 1),
        "visual_seconds": round(visual_seconds, 1),
    }
    return {
        "file": path,
        "duration": round(duration, 1),
        "video": dims,
        "bpm": bpm,
        "yolo_loaded": net is not None,
        "face_loaded": net_face is not None,
        "summary": summary,
        "windows": windows,
    }


def _plan_cell(plan: dict) -> str:
    return f"{plan['shots']}:{plan['dj']}/{plan['dancer']}/{plan['crowd']}/{plan['wide']}"


def print_report(report: dict) -> None:
    video = report["video"]
    print(
        f"{report['file']} — {report['duration']:.0f}s, "
        f"{video['width']}x{video['height']} @ {video['fps']:.0f}fps, {report['bpm']} BPM"
    )
    if not report["yolo_loaded"]:
        print("AVISO: modelo YOLO não carregou — sem detecção de pessoas.")
    print(
        f"{'início':>7} {'mus':>5} {'vis':>5} {'mov':>5} {'escuro':>6} {'dj%':>5} "
        f"{'danç':>4} {'públ':>4} {'beats':>5}  "
        + "  ".join(f"{level:>12}" for level in INTENSITIES)
    )
    for w in report["windows"]:
        if "error" in w:
            print(f"{w['start']:>7} erro: {w['error']}")
            continue
        yes = lambda flag: "sim" if flag else "-"  # noqa: E731
        print(
            f"{w['start']:>7} {w['score_musical']:>5.2f} {w['visual_score']:>5.2f} "
            f"{w['motion_score']:>5.2f} {yes(w['low_light']):>6} "
            f"{w['dj_track_ratio'] * 100:>4.0f}% {yes(w['dancer_found']):>4} "
            f"{yes(w['crowd_found']):>4} {w['beats']:>5}  "
            + "  ".join(f"{_plan_cell(w['plans'][level]):>12}" for level in INTENSITIES)
        )
    s = report["summary"]
    print(
        f"\n{s['windows']} janelas ({s['errors']} com erro) · escuras: {s['low_light_share']} · "
        f"com DJ: {s['dj_found_share']} · persistência mediana do DJ: "
        f"{s['dj_track_ratio_median']} · score visual mediano: {s['visual_score_median']}\n"
        f"tempo: áudio {s['audio_seconds']}s, visual {s['visual_seconds']}s"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video", help="arquivo de vídeo do set")
    parser.add_argument("--top", type=int, default=10, help="nº de janelas candidatas")
    parser.add_argument("--json", dest="json_path", help="grava o relatório completo")
    args = parser.parse_args(argv)

    report = analyze_set(args.video, args.top)
    print_report(report)
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print(f"relatório completo em {args.json_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
