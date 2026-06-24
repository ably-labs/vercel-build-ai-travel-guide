"use client";

import { OBJECT_MODES } from "@ably/ai-transport";
import { ChatTransportProvider } from "@ably/ai-transport/vercel/react";
import { useContext } from "react";

import { BudgetPanel } from "@/components/budget-panel";
import { ChatPanel } from "@/components/chat-panel";
import { ConnectionBadge } from "@/components/connection-badge";
import { DayBoard } from "@/components/day-board";
import { MapPanel } from "@/components/map-panel";
import { PresenceAvatars } from "@/components/presence-avatars";
import { SelectedStopProvider } from "@/components/selected-stop";
import { RealtimeReadyContext } from "@/components/trip-realtime-provider";
import { sessionChannelName } from "@/lib/channels";

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

// The trip canvas body: map, itinerary, budget, and chat.
function CanvasBody({ tripId }: { tripId: string }) {
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
        <main className="grid flex-1 grid-cols-1 gap-2 overflow-auto p-2 md:grid-cols-2 md:grid-rows-[minmax(14rem,1.3fr)_minmax(0,1fr)] md:gap-3 md:p-3 lg:grid-cols-[1.2fr_1.6fr_1fr] lg:grid-rows-[2fr_1fr] lg:overflow-hidden">
          {/* MapPanel renders its own panel chrome (and an expand/collapse
              control), since it lifts out of the grid into a full-viewport
              overlay when expanded. */}
          <MapPanel tripId={tripId} />
          <Panel title="Itinerary" className="min-h-80 md:min-h-0 lg:row-span-2">
            <DayBoard tripId={tripId} />
          </Panel>
          <Panel
            title="Chat"
            accent
            className="min-h-[28rem] md:min-h-64 lg:row-span-2"
          >
            <ChatPanel tripId={tripId} />
          </Panel>
          <Panel title="Budget" className="min-h-44 md:min-h-0">
            <BudgetPanel tripId={tripId} />
          </Panel>
        </main>
      </SelectedStopProvider>
    </div>
  );
}

// One ChatTransportProvider opens the trip's session and shares it with every
// panel: chat reads it via useChatTransport; the canvas and presence read the
// same channel via useClientSession and the ably/react hooks.
//
// channelModes={OBJECT_MODES} lets LiveObjects share the channel; the SDK
// unions it with the modes it always needs, so presence and the conversation
// ride along too. Mounts only once the realtime client is ready, so each panel
// server-renders a placeholder until then.
export function TripCanvas({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);

  if (!ready) {
    return <CanvasBody tripId={tripId} />;
  }

  // clientId comes from the Ably connection token (TripRealtimeProvider sets
  // authParams.clientId).
  return (
    <ChatTransportProvider
      channelName={sessionChannelName(tripId)}
      channelModes={OBJECT_MODES}
      api="/api/chat"
    >
      <CanvasBody tripId={tripId} />
    </ChatTransportProvider>
  );
}
