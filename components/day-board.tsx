"use client";

import { useContext } from "react";

import { useSelectedStop } from "@/components/selected-stop";
import { RealtimeReadyContext } from "@/components/trip-realtime-provider";
import { useTripState } from "@/components/use-trip-state";
import {
  sortedDays,
  STOP_KIND_ICONS,
  stopsOfDay,
  type DayJson,
  type Stop,
} from "@/lib/trip-state";

function StopRow({ stop }: { stop: Stop }) {
  const { selectedStopId, selectStop } = useSelectedStop();
  // Only stops with map coordinates can be flown to; the rest stay as plain
  // display rows.
  const locatable =
    typeof stop.lat === "number" && typeof stop.lng === "number";
  const selected = locatable && selectedStopId === stop.id;

  const body = (
    <>
      <span aria-hidden className="mt-0.5">
        {STOP_KIND_ICONS[stop.kind] ?? "•"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-100">
            {stop.name}
          </span>
          {typeof stop.price === "number" && stop.price > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-zinc-500">
              ${stop.price.toLocaleString()}
            </span>
          )}
        </span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
          {[stop.time, stop.location].filter(Boolean).join(" · ")}
        </span>
      </span>
    </>
  );

  const base =
    "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors";

  if (!locatable) {
    return (
      <li
        className={`${base} border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50`}
      >
        {body}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => selectStop(stop.id)}
        aria-pressed={selected}
        title="Show on map"
        className={`${base} cursor-pointer ${
          selected
            ? "border-sky-400 bg-sky-50 ring-1 ring-sky-300 dark:border-sky-500 dark:bg-sky-950/40 dark:ring-sky-700"
            : "border-zinc-100 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
        }`}
      >
        {body}
      </button>
    </li>
  );
}

function DayCard({ dayId, day }: { dayId: string; day: DayJson }) {
  const stops = stopsOfDay(day);
  return (
    <article
      data-day-id={dayId}
      className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {String(day.title ?? dayId)}
        </h3>
        {day.date != null && (
          <span className="text-xs text-zinc-400">{String(day.date)}</span>
        )}
      </header>
      {stops.length === 0 ? (
        <p className="text-xs text-zinc-400 animate-pulse">Planning…</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {stops.map((stop) => (
            <StopRow key={stop.id} stop={stop} />
          ))}
        </ul>
      )}
    </article>
  );
}

function DayBoardInner({ tripId }: { tripId: string }) {
  const state = useTripState(tripId);
  const days = state?.days ? sortedDays(state.days) : [];

  if (days.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
        Day-by-day itinerary cards will appear here as the AI plans
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {state?.meta?.title && (
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            {state.meta.title}
          </h2>
          {state.meta.summary && (
            <p className="text-xs text-zinc-500">{state.meta.summary}</p>
          )}
        </div>
      )}
      {days.map(([dayId, day]) => (
        <DayCard key={dayId} dayId={dayId} day={day} />
      ))}
    </div>
  );
}

// The day board renders directly from LiveObjects state and updates live as
// the AI writes stops, including mid-stream. Falls back to a static hint
// until the realtime provider is mounted.
export function DayBoard({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);
  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-400 dark:text-zinc-500">
        Day-by-day itinerary cards will appear here
      </div>
    );
  }
  return <DayBoardInner tripId={tripId} />;
}
