"use client";
import { useEffect, useRef, useState } from "react";

type Row = { key: string; name: string; previous: string; current: string };
export default function PlanTransitionStat({ total, reached, lost, previousDate, currentDate, comparable }: {
  total: number; reached: Row[]; lost: Row[]; previousDate: string; currentDate: string; comparable: boolean;
}) {
  const [open, setOpen] = useState<"reached" | "lost" | null>(null);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    const keyboard = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
  }, [open]);
  return <article ref={root} className={`planTransitionStat${open ? " isOpen" : ""}`}>
    <small>Выполнили план</small>
    <strong className="green">{total}{comparable && <span className="planTransitionTriggers">
      {(["reached", "lost"] as const).map(kind => <button key={kind} type="button"
        className={kind === "reached" ? "green" : "red"} aria-expanded={open === kind}
        aria-label={`${kind === "reached" ? "Достигли" : "Утратили"}: ${(kind === "reached" ? reached : lost).length} МО`}
        onClick={e => { trigger.current = e.currentTarget; setOpen(open === kind ? null : kind); }}>
        {kind === "reached" ? "↑" : "↓"}{(kind === "reached" ? reached : lost).length}
      </button>)}
    </span>}</strong>
    {open && <section className="planTransitionPopover" aria-label={open === "reached" ? "Достигли" : "Утратили"}>
      <header><b>{open === "reached" ? "Достигли" : "Утратили"} · {(open === "reached" ? reached : lost).length} МО</b>
        <button type="button" aria-label="Закрыть" onClick={() => { setOpen(null); trigger.current?.focus(); }}>×</button></header>
      <p>{previousDate} → {currentDate}</p>
      <div className="planTransitionList">{(open === "reached" ? reached : lost).length ? (open === "reached" ? reached : lost).map(row =>
        <div key={row.key}><span>{row.name}</span><span>{row.previous} → <b className={open === "reached" ? "green" : "red"}>{row.current}</b></span></div>
      ) : <p>Переходов через план нет</p>}</div>
    </section>}
  </article>;
}
