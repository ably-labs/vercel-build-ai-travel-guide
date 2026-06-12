// Channel naming for a trip. Everything about a trip is namespaced under
// trip:{tripId}:* (the `trip` namespace rule has mutable messages and
// persistence enabled, which AI Transport requires).
import { isValidTripId } from "@/lib/trip-id";

export function sessionChannelName(tripId: string): string {
  return `trip:${tripId}:session`;
}

export function stateChannelName(tripId: string): string {
  return `trip:${tripId}:state`;
}

// Ephemeral pin-placement events for the map animation. The durable pin data
// lives in LiveObjects (the destinations map on the state channel); losing
// one of these on reload is fine.
export function pinsChannelName(tripId: string): string {
  return `trip:${tripId}:pins`;
}

// Parse and validate a session channel name received from the network.
// Returns the tripId, or null if it isn't a well-formed trip session channel.
export function tripIdFromSessionChannel(channelName: string): string | null {
  const match = /^trip:([a-z0-9]+):session$/.exec(channelName);
  if (!match || !isValidTripId(match[1])) {
    return null;
  }
  return match[1];
}
