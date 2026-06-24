"use client";

import { usePresence, usePresenceListener } from "ably/react";
import { useContext } from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";
import { sessionChannelName } from "@/lib/channels";
// The deterministic identity (name + initials + colour) is shared with chat
// message attribution, so a collaborator looks the same in the nav bar and chat.
import { identityFor } from "@/lib/identity";
import { getVisitorId } from "@/lib/visitor";

const MAX_AVATARS = 5;

function AvatarStack({ tripId }: { tripId: string }) {
  // Presence rides the trip's session channel. The ChatTransportProvider above
  // renders that channel's ChannelProvider, so these ably/react hooks resolve
  // it with no wrapper of our own: usePresence keeps us in the set while
  // mounted, usePresenceListener tracks the live membership.
  const channelName = sessionChannelName(tripId);
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
// trip, live via Ably presence on the session channel. Renders nothing until
// the realtime provider is mounted, since the presence hooks need the session
// channel's ChannelProvider (and a live AblyProvider) above them.
export function PresenceAvatars({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);
  if (!ready) {
    return null;
  }
  return <AvatarStack tripId={tripId} />;
}
