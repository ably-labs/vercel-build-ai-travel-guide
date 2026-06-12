"use client";

import { useContext } from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";
import { useTripState } from "@/components/use-trip-state";
import { budgetByCategory } from "@/lib/trip-state";

function BudgetPanelInner({ tripId }: { tripId: string }) {
  const state = useTripState(tripId);
  const total = state?.budget ?? 0;
  const categories = budgetByCategory(state?.days);
  const pricedStops = categories.reduce((sum, cat) => sum + cat.count, 0);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
      <div className="flex flex-col items-center gap-1">
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

      {categories.length > 0 && (
        <dl className="flex w-full max-w-xs flex-col gap-1">
          {categories.map((cat) => (
            <div
              key={cat.label}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <dt className="text-zinc-500 dark:text-zinc-400">
                {cat.label}
              </dt>
              <dd className="tabular-nums font-medium text-zinc-700 dark:text-zinc-200">
                ${cat.total.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      )}
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
