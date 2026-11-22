"use client";

import { useEffect, useRef, useState } from "react";
import type { Marker } from "maplibre-gl";
import type { LngLat } from "@/shared";
import { useMapCtx } from "./BaseMap";

interface DragHandleProps {
  at: LngLat;
  label: string;
  variant?: "vertex" | "mid" | "center" | "radius" | "phase";
  text?: string;
  active?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDrag?: (p: LngLat) => void;
  onDragEnd?: (p: LngLat) => void;
  onTap?: () => void;
}

const LOOK: Record<NonNullable<DragHandleProps["variant"]>, string> = {
  vertex: "size-4 rounded-full border-2 border-white bg-[#111827] shadow",
  mid: "size-3.5 rounded-full border-2 border-[#111827] bg-white/90 shadow",
  center: "size-6 rounded-full border-2 border-white bg-[#111827] shadow-md",
  radius: "size-5 rounded-full border-2 border-[#111827] bg-white shadow-md",
  phase: "flex size-7 items-center justify-center rounded-full border-2 border-white bg-[#111827] text-[11px] font-bold text-white shadow-md",
};

/** Draggable editor handle: a 44 px touch target around a small visible dot. */
export function DragHandle({ at, label, variant = "vertex", text, active, draggable = true, onDragStart, onDrag, onDragEnd, onTap }: DragHandleProps) {
  const { map, ml } = useMapCtx();
  // MapLibre owns the root's classes; our styles live on the inner button.
  const [el] = useState(() => {
    if (typeof document === "undefined") return null;
    const root = document.createElement("div");
    const btn = document.createElement("button");
    btn.type = "button";
    root.appendChild(btn);
    return root;
  });
  const marker = useRef<Marker | null>(null);
  const cbs = useRef({ onDragStart, onDrag, onDragEnd, onTap });
  useEffect(() => {
    cbs.current = { onDragStart, onDrag, onDragEnd, onTap };
  });

  useEffect(() => {
    if (!map || !ml || !el) return;
    const m = new ml.Marker({ element: el, draggable });
    marker.current = m;
    let moved = false;
    const ll = (): LngLat => {
      const p = m.getLngLat();
      return [p.lng, p.lat];
    };
    m.on("dragstart", () => {
      moved = true;
      cbs.current.onDragStart?.();
    });
    m.on("drag", () => cbs.current.onDrag?.(ll()));
    m.on("dragend", () => {
      cbs.current.onDragEnd?.(ll());
      setTimeout(() => (moved = false), 0);
    });
    const click = (e: MouseEvent) => {
      e.stopPropagation();
      if (!moved) cbs.current.onTap?.();
    };
    const btn = el.firstElementChild as HTMLButtonElement;
    btn.addEventListener("click", click);
    m.setLngLat(at).addTo(map);
    return () => {
      btn.removeEventListener("click", click);
      m.remove();
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- position synced below
  }, [map, ml, el, draggable]);

  useEffect(() => {
    marker.current?.setLngLat(at);
  }, [at]);

  useEffect(() => {
    const btn = marker.current?.getElement().firstElementChild as HTMLButtonElement | null | undefined;
    if (!btn) return;
    btn.setAttribute("aria-label", label);
    btn.className = "flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/60 touch-none cursor-grab";
    btn.replaceChildren();
    const dot = document.createElement("span");
    dot.className = LOOK[variant] + (active ? " ring-3 ring-primary" : "");
    if (text) dot.textContent = text;
    btn.appendChild(dot);
  }, [map, ml, label, variant, text, active, draggable]);

  return null;
}
