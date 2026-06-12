"use client";

import { BudgetPanel } from "@/components/budget-panel";
import { ChatPanel } from "@/components/chat-panel";
import { ConnectionBadge } from "@/components/connection-badge";
import { DayBoard } from "@/components/day-board";
import { MapPanel } from "@/components/map-panel";

function Panel({
  title,
  hint,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <header className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
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
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-bold tracking-tight">Wayfarer</h1>
          <span className="font-mono text-xs text-zinc-400">
            trip/{tripId}
          </span>
        </div>
        <ConnectionBadge />
      </header>

      <main className="grid flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-[1.2fr_1.6fr_1fr] lg:grid-rows-[2fr_1fr] lg:overflow-hidden">
        <Panel title="Map" className="min-h-48 lg:row-span-1">
          <MapPanel tripId={tripId} />
        </Panel>
        <Panel title="Day board" className="min-h-48 lg:row-span-2">
          <DayBoard tripId={tripId} />
        </Panel>
        <Panel title="Chat" className="min-h-96 lg:row-span-2">
          <ChatPanel tripId={tripId} />
        </Panel>
        <Panel title="Budget" className="min-h-32">
          <BudgetPanel tripId={tripId} />
        </Panel>
      </main>
    </div>
  );
}
