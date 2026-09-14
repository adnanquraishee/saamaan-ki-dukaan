import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tower: {
          bg: "#060a0f",
          panel: "#0b1219",
          panel2: "#0f1822",
          line: "#1a2633",
          dim: "#5b6b7c",
          text: "#c9d6e2",
          cyan: "#2dd4bf",
          blue: "#38bdf8",
          amber: "#f5a524",
          red: "#f0525b",
          green: "#4ade80",
          violet: "#a78bfa",
        },
        shop: {
          ink: "#1c1917",
          paper: "#faf7f2",
          clay: "#c2410c",
          moss: "#3f6212",
          sand: "#e7e0d4",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        sans: ["ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        serif: ["ui-serif", "Georgia", "Cambria", "Times New Roman", "serif"],
      },
      keyframes: {
        pulseRing: { "0%": { boxShadow: "0 0 0 0 rgba(45,212,191,.5)" }, "100%": { boxShadow: "0 0 0 8px rgba(45,212,191,0)" } },
        slideIn: { "0%": { opacity: "0", transform: "translateY(-4px)" }, "100%": { opacity: "1", transform: "none" } },
      },
      animation: { pulseRing: "pulseRing 1.2s ease-out infinite", slideIn: "slideIn .25s ease-out" },
    },
  },
  plugins: [],
};
export default config;
