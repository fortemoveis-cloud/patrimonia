import { useEffect, useState } from "react";

/* Chart icon — same visual as the favicon/sidebar logo */
function ChartIcon({ size = 64 }) {
  const r   = size / 2;
  const pad = size * 0.22;
  // Points scaled to the viewBox
  const pts = [
    [pad,             size - pad * 0.6],
    [size * 0.38,     size * 0.50],
    [size * 0.55,     size * 0.62],
    [size - pad,      pad * 0.85],
  ].map(([x, y]) => `${x},${y}`).join(" ");
  const [ex, ey] = [size - pad, pad * 0.85];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={r} cy={r} r={r} fill="#1E2D8A"/>
      <polyline
        points={pts}
        stroke="#A78BFA"
        strokeWidth={size * 0.062}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={ex} cy={ey} r={size * 0.085} fill="#7C3AED"/>
    </svg>
  );
}

export default function SplashScreen({ onDone }) {
  const [show, setShow]   = useState(false);   // drives fade-in
  const [fading, setFading] = useState(false); // drives fade-out
  const [gone, setGone]   = useState(false);

  useEffect(() => {
    // Start fade-in on next tick
    const t0 = setTimeout(() => setShow(true),    30);
    // Start fade-out at 1.5 s
    const t1 = setTimeout(() => setFading(true),  1500);
    // Remove from DOM at 2 s
    const t2 = setTimeout(() => { setGone(true); onDone?.(); }, 2000);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (gone) return null;

  return (
    <div
      style={{
        position:       "fixed",
        inset:          0,
        zIndex:         9999,
        background:     "#0F1547",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        gap:            20,
        opacity:        fading ? 0 : 1,
        transition:     "opacity 0.5s ease",
        pointerEvents:  fading ? "none" : "all",
      }}
    >
      {/* Icon */}
      <div
        style={{
          opacity:    show ? 1 : 0,
          transform:  show ? "scale(1) translateY(0)" : "scale(0.75) translateY(12px)",
          transition: "opacity 0.8s ease, transform 0.8s cubic-bezier(0.34,1.3,0.64,1)",
        }}
      >
        <ChartIcon size={80} />
      </div>

      {/* Name */}
      <div
        style={{
          textAlign:  "center",
          opacity:    show ? 1 : 0,
          transform:  show ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.8s ease 0.12s, transform 0.8s ease 0.12s",
        }}
      >
        <h1
          style={{
            margin:        0,
            fontFamily:    "Georgia, 'Times New Roman', serif",
            fontSize:      36,
            fontWeight:    700,
            letterSpacing: "-0.3px",
            lineHeight:    1,
          }}
        >
          <span style={{ color: "#ffffff" }}>Patrimon</span>
          <span style={{ color: "#A78BFA" }}>IA</span>
        </h1>

        <p
          style={{
            margin:        "10px 0 0",
            fontFamily:    "Inter, sans-serif",
            fontSize:      12,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color:         "#6D79D6",
          }}
        >
          Gestão Patrimonial Inteligente
        </p>
      </div>
    </div>
  );
}
