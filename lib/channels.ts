// Channel naming for a trip. Chat, the LiveObjects canvas state, and presence
// all share one channel, trip:{tripId}:session. The `trip` namespace rule
// enables mutable messages and persistence, which AI Transport requires.
import { isValidTripId } from "@/lib/trip-id";

export function sessionChannelName(tripId: string): string {
  return `trip:${tripId}:session`;
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
