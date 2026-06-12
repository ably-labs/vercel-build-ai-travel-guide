"use client";

import { BudgetPanel } from "@/components/budget-panel";
import { ChatPanel } from "@/components/chat-panel";
import { ConnectionBadge } from "@/components/connection-badge";
import { DayBoard } from "@/components/day-board";
import { MapPanel } from "@/components/map-panel";
import { PresenceAvatars } from "@/components/presence-avatars";
import { SelectedStopProvider } from "@/components/selected-stop";

function Panel({
  title,
  hint,
  className = "",
  accent = false,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  // The chat panel reads as the AI surface: a teal brand-accent tint and
  // border set it apart from the neutral zinc canvas panels (map, itinerary,
  // budget). Tuned for AA legibility in both light and dark mode.
  const surface = accent
    ? "border-teal-300 bg-teal-50 dark:border-teal-800 dark:bg-teal-950"
    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  const headerBorder = accent
    ? "border-teal-200 text-teal-900 dark:border-teal-800/70 dark:text-teal-100"
    : "border-zinc-100 text-zinc-700 dark:border-zinc-800 dark:text-zinc-200";
  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border ${surface} ${className}`}
    >
      <header
        className={`border-b px-4 py-2.5 text-sm font-semibold ${headerBorder}`}
      >
        {title}
      </header>
      {children ?? (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-400 dark:text-zinc-500">
          {hint}
        </div>
      )}
    </section>
  );
}

// The static four-region canvas for Milestone 0: map, day board, budget, and
// chat, with no live content yet. Later milestones fill each region from
// LiveObjects state and the AI Transport session.
export function TripCanvas({ tripId }: { tripId: string }) {
  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 items-baseline gap-2 sm:gap-3">
          <h1 className="shrink-0 text-base font-bold tracking-tight">
            Wayfarer
          </h1>
          <span className="hidden truncate font-mono text-xs text-zinc-400 sm:inline">
            trip/{tripId}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <PresenceAvatars tripId={tripId} />
          <ConnectionBadge />
        </div>
      </header>

      {/* Selecting a stop in the day board flies the map to it, so both panels
          share the selected-stop context. */}
      <SelectedStopProvider>
        <main className="grid flex-1 grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-2 md:grid-rows-[minmax(14rem,1.3fr)_minmax(0,1fr)] lg:grid-cols-[1.2fr_1.6fr_1fr] lg:grid-rows-[2fr_1fr] lg:overflow-hidden">
          {/* MapPanel renders its own panel chrome (and an expand/collapse
              control), since it lifts out of the grid into a full-viewport
              overlay when expanded. */}
          <MapPanel tripId={tripId} />
          <Panel title="Itinerary" className="min-h-56 md:min-h-0 lg:row-span-2">
            <DayBoard tripId={tripId} />
          </Panel>
          <Panel
            title="Chat"
            accent
            className="min-h-96 md:min-h-64 lg:row-span-2"
          >
            <ChatPanel tripId={tripId} />
          </Panel>
          <Panel title="Budget" className="min-h-32 md:min-h-0">
            <BudgetPanel tripId={tripId} />
          </Panel>
        </main>
      </SelectedStopProvider>
    </div>
  );
}
