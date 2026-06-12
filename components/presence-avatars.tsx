"use client";

import { ChannelProvider, usePresence, usePresenceListener } from "ably/react";
import { useContext } from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";
import { presenceChannelName } from "@/lib/channels";
import { getVisitorId } from "@/lib/visitor";

// Auth is out of scope (anyone with the link is a collaborator), so each
// participant gets a deterministic identity derived from their clientId.
// Every browser derives the same name and colour for a given clientId, so
// nothing needs to travel in the presence payload.
const ADJECTIVES = [
  "Amber",
  "Brisk",
  "Coral",
  "Dusty",
  "Eager",
  "Fabled",
  "Gilded",
  "Hardy",
  "Indigo",
  "Jolly",
  "Keen",
  "Lucky",
  "Mellow",
  "Nimble",
  "Plucky",
  "Roving",
];

const TRAVELLERS = [
  "Albatross",
  "Bison",
  "Caravan",
  "Drifter",
  "Explorer",
  "Falcon",
  "Gull",
  "Heron",
  "Ibis",
  "Jetsetter",
  "Kestrel",
  "Lynx",
  "Mariner",
  "Nomad",
  "Osprey",
  "Pilgrim",
];

const COLORS = [
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#ec4899", // pink
  "#6366f1", // indigo
];

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function identityFor(clientId: string) {
  const hash = hashOf(clientId);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const traveller = TRAVELLERS[Math.floor(hash / 16) % TRAVELLERS.length];
  return {
    name: `${adjective} ${traveller}`,
    initials: `${adjective[0]}${traveller[0]}`,
    color: COLORS[hash % COLORS.length],
  };
}

const MAX_AVATARS = 5;

function AvatarStack({ channelName }: { channelName: string }) {
  // Enter the presence set for as long as the avatar stack is mounted, and
  // re-render from the live membership snapshot as others come and go.
  usePresence(channelName);
  const { presenceData } = usePresenceListener(channelName);

  const selfId = getVisitorId();
  // One avatar per person (clientId), however many tabs or connections they
  // hold. Self sorts first so "you" is always the anchor of the stack.
  const clientIds = [...new Set(presenceData.map((m) => m.clientId))].sort(
    (a, b) =>
      Number(b === selfId) - Number(a === selfId) || a.localeCompare(b),
  );

  const shown = clientIds.slice(0, MAX_AVATARS);
  const overflow = clientIds.length - shown.length;

  return (
    <div
      className="flex items-center"
      data-presence-count={clientIds.length}
      title={clientIds
        .map((id) =>
          id === selfId ? `${identityFor(id).name} (you)` : identityFor(id).name,
        )
        .join(", ")}
    >
      <span className="flex -space-x-1.5">
        {shown.map((clientId) => {
          const { name, initials, color } = identityFor(clientId);
          const isSelf = clientId === selfId;
          return (
            <span
              key={clientId}
              data-presence-member={clientId}
              aria-label={isSelf ? `${name} (you)` : name}
              className={`wayfarer-presence-avatar flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ${
                isSelf
                  ? "ring-zinc-900 dark:ring-white"
                  : "ring-white dark:ring-zinc-900"
              }`}
              style={{ backgroundColor: color }}
            >
              {initials}
            </span>
          );
        })}
      </span>
      {overflow > 0 && (
        <span className="ml-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          +{overflow}
        </span>
      )}
    </div>
  );
}

// Collaborator avatars for the trip header: everyone currently viewing this
// trip, live via Ably presence. Renders nothing until the realtime provider
// is mounted, since the presence hooks need a live AblyProvider above them.
export function PresenceAvatars({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);
  if (!ready) {
    return null;
  }
  const channelName = presenceChannelName(tripId);
  return (
    <ChannelProvider channelName={channelName}>
      <AvatarStack channelName={channelName} />
    </ChannelProvider>
  );
}
