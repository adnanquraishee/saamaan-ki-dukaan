"use client";
import { useEffect, useState } from "react";

export function Live3DBackground() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const move = (e: PointerEvent) => setPointer({ x: (e.clientX / window.innerWidth - 0.5) * 2, y: (e.clientY / window.innerHeight - 0.5) * 2 });
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-[#fbf8f2]"><div className="live-grid absolute inset-0 opacity-40" /><div className="live-orb live-orb-a" style={{ transform: `translate3d(${pointer.x * -18}px,${pointer.y * -12}px,0)` }} /><div className="live-orb live-orb-b" style={{ transform: `translate3d(${pointer.x * 24}px,${pointer.y * 16}px,0)` }} /><div className="live-orb live-orb-c" style={{ transform: `translate3d(${pointer.x * -10}px,${pointer.y * 20}px,0)` }} /></div>;
}
