"use client";

import { useConnectionStateListener } from "ably/react";
import { useContext, useState } from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";

const STATE_STYLES: Record<string, { dot: string; label: string }> = {
  connected: { dot: "bg-emerald-500", label: "Connected" },
  connecting: { dot: "bg-amber-400 animate-pulse", label: "Connecting" },
  disconnected: { dot: "bg-amber-500", label: "Reconnecting" },
  suspended: { dot: "bg-red-500", label: "Offline" },
  failed: { dot: "bg-red-600", label: "Connection failed" },
  closing: { dot: "bg-zinc-400", label: "Closing" },
  closed: { dot: "bg-zinc-400", label: "Closed" },
  initialized: { dot: "bg-amber-400 animate-pulse", label: "Connecting" },
};

function Badge({ state }: { state: string }) {
  const { dot, label } = STATE_STYLES[state] ?? STATE_STYLES.initialized;
  return (
    <span
      data-connection-state={state}
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function LiveBadge() {
  const [state, setState] = useState("initialized");
  useConnectionStateListener((stateChange) => {
    setState(stateChange.current);
  });
  return <Badge state={state} />;
}

// Live Ably connection indicator — the Milestone 0 proof that the browser has
// authenticated and holds an open realtime connection. Renders a static
// "Connecting" state until the realtime provider is mounted, since the ably
// hooks can only be called under a mounted AblyProvider.
export function ConnectionBadge() {
  const ready = useContext(RealtimeReadyContext);
  return ready ? <LiveBadge /> : <Badge state="initialized" />;
}
