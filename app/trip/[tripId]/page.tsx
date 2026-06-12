import { notFound } from "next/navigation";

import { TripCanvas } from "@/components/trip-canvas";
import { TripRealtimeProvider } from "@/components/trip-realtime-provider";
import { isValidTripId } from "@/lib/trip-id";

// A trip is addressable purely by the ID in the URL. There is no creation
// step: a fresh ID is an empty trip, and all of its state lives in Ably
// channels namespaced as trip:{tripId}:*.
export default async function TripPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  if (!isValidTripId(tripId)) {
    notFound();
  }

  return (
    <TripRealtimeProvider>
      <TripCanvas tripId={tripId} />
    </TripRealtimeProvider>
  );
}
