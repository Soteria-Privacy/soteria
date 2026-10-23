import { useEffect, useState } from "react";
import { motion, useReducedMotion, type TargetAndTransition } from "framer-motion";

const HONEST = "#5aa8ff";
const SHIELD = "#ff5fd8";
const MUTED = "#9a93c7";

type P = { x: number; y: number };
const N: Record<string, P> = {
  s1: { x: 64, y: 132 },
  h2: { x: 158, y: 214 },
  h3: { x: 252, y: 128 },
  d4: { x: 384, y: 84 },
  r5: { x: 372, y: 256 },
  r6: { x: 120, y: 322 },
  d7: { x: 300, y: 330 },
};
const EDGES: [string, string][] = [
  ["s1", "h2"], ["h2", "h3"], ["h3", "d4"], ["h3", "r5"],
  ["h2", "r6"], ["r5", "d7"], ["s1", "h3"],
];
const LABELS: Record<string, string> = {
  s1: "7xQ…aF", h2: "b3c…91", h3: "Δ2…e7", r5: "9k…2c", r6: "e1…7d",
};
const SHIELDED: Record<string, string> = { d4: "amount", d7: "identity" };
const order = Object.keys(N);

function CipherText({ kind = "hex" }: { kind?: "hex" | "id" }) {
  const charset = kind === "hex" ? "0123456789abcdef" : "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const len = kind === "hex" ? 4 : 5;
  const prefix = kind === "hex" ? "0x" : "";
  const [s, setS] = useState(prefix + charset.slice(0, len));
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      let o = "";
      for (let i = 0; i < len; i++) o += charset[(Math.random() * charset.length) | 0];
      setS(prefix + o);
    }, 110);
    return () => clearInterval(id);
  }, [reduce, charset, len, prefix]);
  return <>{s}</>;
}

export function LiveGraph() {
  const reduce = useReducedMotion();
  const anim = (a: TargetAndTransition): TargetAndTransition => (reduce ? {} : a);

  return (
    <svg viewBox="0 0 448 380" width="100%" style={{ maxHeight: 460, overflow: "visible" }}>
      <motion.g
        animate={anim({ y: [0, -6, 0] })}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* edges — the graph stays drawn */}
        {EDGES.map(([a, b], i) => (
          <motion.line
            key={`e${i}`}
            x1={N[a].x} y1={N[a].y} x2={N[b].x} y2={N[b].y}
            stroke={HONEST} strokeWidth={1} strokeOpacity={0.4}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.9, delay: i * 0.1, ease: "easeInOut" }}
          />
        ))}

        {/* transaction particles flowing along the edges */}
        {EDGES.map(([a, b], i) => (
          <motion.circle
            key={`p${i}`}
            r={2.6} fill={HONEST}
            initial={{ opacity: 0, cx: N[a].x, cy: N[a].y }}
            animate={anim({
              cx: [N[a].x, N[b].x],
              cy: [N[a].y, N[b].y],
              opacity: [0, 1, 1, 0],
            })}
            transition={{
              duration: 2.6, delay: 1.1 + i * 0.33,
              repeat: Infinity, repeatDelay: 0.7, ease: "linear",
            }}
            style={{ filter: `drop-shadow(0 0 5px ${HONEST})` }}
          />
        ))}

        {/* nodes */}
        {order.map((id, idx) => {
          const { x, y } = N[id];
          const shielded = id in SHIELDED;
          const color = shielded ? SHIELD : HONEST;
          const delay = 0.7 + idx * 0.09;
          return (
            <g key={id}>
              {shielded && (
                <motion.circle
                  cx={x} cy={y} fill={SHIELD}
                  initial={{ r: 0, opacity: 0.25 }}
                  animate={anim({ r: [14, 20, 14], opacity: [0.22, 0.05, 0.22] })}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay }}
                />
              )}
              <motion.circle
                cx={x} cy={y} fill="#080420" stroke={color} strokeWidth={shielded ? 1.6 : 1.2}
                initial={{ r: 0 }} animate={{ r: shielded ? 8 : 6 }}
                transition={{ delay, type: "spring", stiffness: 300, damping: 17 }}
              />
              <motion.circle
                cx={x} cy={y} r={shielded ? 3 : 2.4} fill={color}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.15 }}
                style={{ filter: `drop-shadow(0 0 6px ${color})` }}
              />
              <motion.text
                x={x} y={y + (y > 300 ? -16 : 22)} textAnchor="middle"
                fontFamily="'Space Mono', monospace" fontSize={10.5}
                fill={shielded ? SHIELD : MUTED}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.3 }}
              >
                {shielded ? <CipherText kind={id === "d4" ? "hex" : "id"} /> : LABELS[id]}
              </motion.text>
            </g>
          );
        })}
      </motion.g>
    </svg>
  );
}
