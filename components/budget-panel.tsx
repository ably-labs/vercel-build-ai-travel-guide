"use client";

import { useContext } from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";
import { useTripState } from "@/components/use-trip-state";
import { sortedDays, stopsOfDay } from "@/lib/trip-state";

function BudgetPanelInner({ tripId }: { tripId: string }) {
  const state = useTripState(tripId);
  const total = state?.budget ?? 0;
  const pricedStops = state?.days
    ? sortedDays(state.days)
        .flatMap(([, day]) => stopsOfDay(day))
        .filter((stop) => typeof stop.price === "number" && stop.price > 0)
        .length
    : 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4">
      {/* Keyed on the total so the pop animation replays on every change. */}
      <span
        key={total}
        className="wayfarer-budget-pop text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50"
      >
        ${total.toLocaleString()}
      </span>
      <span className="text-xs text-zinc-400 dark:text-zinc-500">
        {pricedStops === 0
          ? "estimated trip total"
          : `estimated total across ${pricedStops} priced ${
              pricedStops === 1 ? "item" : "items"
            }`}
      </span>
    </div>
  );
}

// Running trip total, read live from the LiveObjects budget counter. The
// server reconciles the counter to the sum of the trip's current priced stops
// on every change, so it always matches the board (no stale accumulation).
export function BudgetPanel({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);
  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-400 dark:text-zinc-500">
        Running trip total will appear here
      </div>
    );
  }
  return <BudgetPanelInner tripId={tripId} />;
}
