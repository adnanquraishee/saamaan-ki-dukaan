"use client";
import { formatSimTime } from "@/lib/engine/calendar";
import { useApp } from "@/lib/store/store";
import { Panel } from "./ui";

export function SecurityLog() {
  const events = useApp((s) => s.security);
  const detection = useApp((s) => s.settings.injectionDetection);
  return (
    <Panel title="Untrusted-content log" right={<span className={`font-mono text-[10px] uppercase ${detection ? "text-tower-green" : "text-tower-red"}`}>detector {detection ? "on" : "off"}</span>} bodyClass="overflow-y-auto scroll-thin">
      {!events.length && <div className="p-4 text-center font-mono text-xs text-tower-dim">No instruction-shaped content seen.</div>}
      <ul className="divide-y divide-tower-line/60">
        {[...events].reverse().slice(0, 30).map((e) => (
          <li key={e.id} className="px-3 py-2">
            <div className="flex justify-between font-mono text-[10px]">
              <span className="uppercase tracking-wider text-tower-red">{e.surface.replace("_", " ")}</span>
              <span className="text-tower-dim">{formatSimTime(e.tick)}</span>
            </div>
            <div className="mt-0.5 text-xs text-tower-text">{e.note}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {e.hits.slice(0, 4).map((h, i) => (
                <span key={i} className="rounded-sm bg-tower-red/10 px-1.5 font-mono text-[10px] text-[#ff9aa0]" title={h.excerpt}>
                  {h.label}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
