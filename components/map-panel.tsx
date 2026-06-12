"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";

function MapHint() {
  return (
    <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-400 dark:text-zinc-500">
      Destination pins will appear here
    </div>
  );
}

// MapLibre touches the DOM at init, so the map view only loads in the
// browser; the realtime guard also keeps it from mounting before the Ably
// provider exists.
const MapView = dynamic(
  () => import("@/components/map-view").then((m) => m.MapView),
  { ssr: false, loading: MapHint },
);

function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M12 4h4v4M16 4l-5 5M8 16H4v-4M4 16l5-5" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M15 5l-4 4V5m0 4h4M5 15l4-4v4m0-4H5" />
    </svg>
  );
}

const ANIM_MS = 320;

// The map's own panel. It renders the same chrome as the other trip-canvas
// panels (rounded card + header), but owns an expand/collapse state of its own:
// when expanded it lifts out of the grid into a full-viewport overlay.
//
// "Grows in place" is done with a FLIP transition. Switching `position` can't
// be animated by CSS (it's a discrete property), so on each toggle we measure
// the panel's rect before and after the class change, then run a single
// transform that interpolates the box from its old geometry to its new one.
// The same <section> element (and the MapView + MapLibre instance inside it)
// is never unmounted, so the map's center, zoom, markers, and interactivity
// all carry across the toggle; a ResizeObserver inside MapView keeps the tiles
// sized to the box as it animates.
export function MapPanel({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  // The element's on-screen rect captured the instant before a class change,
  // used as the FLIP "First" snapshot.
  const firstRectRef = useRef<DOMRect | null>(null);

  const toggle = useCallback(() => {
    firstRectRef.current =
      sectionRef.current?.getBoundingClientRect() ?? null;
    setExpanded((value) => !value);
  }, []);

  // Escape collapses, but only while expanded (don't swallow Escape otherwise).
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, toggle]);

  // FLIP: after React has applied the new positioning class (Last), invert to
  // the old rect with a transform, then play forward to identity.
  useLayoutEffect(() => {
    const el = sectionRef.current;
    const first = firstRectRef.current;
    if (!el || !first) return;
    firstRectRef.current = null;

    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = last.width === 0 ? 1 : first.width / last.width;
    const sy = last.height === 0 ? 1 : first.height / last.height;

    // Invert: jump back to where/what it looked like before, with no transition.
    el.style.transformOrigin = "top left";
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;

    // Play: next frame, transition the transform away to land at the new box.
    const raf = requestAnimationFrame(() => {
      el.style.transition = `transform ${ANIM_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1)`;
      el.style.transform = "";
    });

    const onEnd = () => {
      el.style.transition = "";
      el.style.transform = "";
      el.style.transformOrigin = "";
    };
    el.addEventListener("transitionend", onEnd, { once: true });

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("transitionend", onEnd);
    };
  }, [expanded]);

  return (
    <>
      {/* When expanded, a spacer holds the map's place in the grid so the
          surrounding itinerary/budget panels don't reflow as the map lifts out
          into the overlay. */}
      {expanded && <div className="min-h-48 lg:row-span-1" aria-hidden />}
      <section
        ref={sectionRef}
        className={
          "flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 " +
          (expanded
            ? "fixed inset-2 z-50 shadow-2xl sm:inset-4"
            : "relative min-h-48 lg:row-span-1")
        }
      >
        <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
          <span>Map</span>
          <button
            type="button"
            onClick={toggle}
            aria-label={expanded ? "Collapse map" : "Expand map"}
            aria-pressed={expanded}
            title={expanded ? "Collapse map (Esc)" : "Expand map"}
            className="flex items-center justify-center rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        </header>
        {ready ? <MapView tripId={tripId} /> : <MapHint />}
      </section>
    </>
  );
}
