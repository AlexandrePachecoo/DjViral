import { font } from "./theme";

// Brand wordmark: 4 animated equalizer bars + "DJviral".
export function Logo() {
  const opacities = [0.5, 0.68, 0.84, 1];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 21 }}>
        {opacities.map((o, i) => (
          <span
            key={i}
            className="dj-logobar"
            data-anim
            style={{ opacity: o, animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <div style={{ fontSize: 23, display: "flex", alignItems: "baseline", color: "#18181b" }}>
        <span style={{ fontFamily: font.display, fontWeight: 700, letterSpacing: "-.03em" }}>
          DJ
        </span>
        <span style={{ fontFamily: font.wordmark, fontWeight: 200 }}>viral</span>
      </div>
    </div>
  );
}
