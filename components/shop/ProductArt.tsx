import type { Category } from "@/lib/types";

const PALETTES = [
  ["#c2410c", "#fed7aa", "#7c2d12"],
  ["#3f6212", "#d9f99d", "#1a2e05"],
  ["#1e3a8a", "#bfdbfe", "#172554"],
  ["#9d174d", "#fbcfe8", "#500724"],
  ["#854d0e", "#fde68a", "#422006"],
  ["#115e59", "#99f6e4", "#042f2e"],
  ["#6b21a8", "#e9d5ff", "#3b0764"],
  ["#374151", "#e5e7eb", "#111827"],
];

/** Deterministic, offline product illustration — no external images during a demo. */
export function ProductArt({ seed, category, className = "" }: { seed: number; category: Category; className?: string }) {
  const [main, soft, deep] = PALETTES[seed % PALETTES.length];
  const v = (seed >> 3) % 5;
  const id = `g${seed}`;
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-hidden>
      <defs>
        <pattern id={`${id}p`} width={14 + v * 3} height={14 + v * 3} patternUnits="userSpaceOnUse">
          {category === "home" ? <path d={`M0 ${7 + v} h${14 + v * 3}`} stroke={main} strokeOpacity=".25" strokeWidth="2" /> : <circle cx="4" cy="4" r="1.6" fill={main} fillOpacity=".25" />}
        </pattern>
      </defs>
      <rect width="200" height="200" fill={soft} />
      <rect width="200" height="200" fill={`url(#${id}p)`} />
      {category === "apparel" && (
        <g>
          <path d="M62 52 L84 40 Q100 52 116 40 L138 52 L158 78 L140 90 L134 82 L134 162 L66 162 L66 82 L60 90 L42 78 Z" fill={main} />
          <path d="M84 40 Q100 60 116 40" fill="none" stroke={deep} strokeWidth="3" />
          {v % 2 === 0 && <path d="M66 110 H134 M66 124 H134" stroke={soft} strokeOpacity=".5" strokeWidth="4" />}
        </g>
      )}
      {category === "electronics" && (
        <g>
          <rect x="52" y="58" width="96" height="84" rx={v % 2 ? 42 : 18} fill={deep} />
          <circle cx="100" cy="100" r="26" fill={main} />
          <circle cx="100" cy="100" r="10" fill={soft} />
          <rect x="88" y="146" width="24" height="6" rx="3" fill={main} />
        </g>
      )}
      {category === "home" && (
        <g>
          <rect x="46" y="70" width="108" height="78" rx="6" fill={main} />
          <path d="M46 92 H154 M46 116 H154" stroke={soft} strokeWidth="3" strokeDasharray="6 5" />
          <path d="M60 70 Q100 30 140 70" fill="none" stroke={deep} strokeWidth="5" />
        </g>
      )}
      {category === "personal_care" && (
        <g>
          <rect x="80" y="46" width="40" height="18" rx="4" fill={deep} />
          <rect x="66" y="62" width="68" height="96" rx="16" fill={main} />
          <rect x="78" y="92" width="44" height="30" rx="4" fill={soft} fillOpacity=".85" />
        </g>
      )}
    </svg>
  );
}
