import Ably from "ably";
import { LiveObjects, type RestObjectOperation } from "ably/liveobjects";

import { stateChannelName } from "@/lib/channels";
import type { Destination, Stop, TripMeta } from "@/lib/trip-state";

// Server-side writer for a trip's LiveObjects state. Uses the REST object
// API (stateless HTTP — right for a serverless route) with path-based,
// atomic batch operations.
export class TripStateWriter {
  private channel;

  constructor(tripId: string, apiKey: string) {
    const rest = new Ably.Rest({ key: apiKey, plugins: { LiveObjects } });
    this.channel = rest.channels.get(stateChannelName(tripId));
  }

  // Create the fixed top-level structure if this trip has never been written
  // to. Guarded by a read so re-running never replaces existing objects
  // (mapCreate at an occupied path would clobber it).
  async ensureInitialized(): Promise<void> {
    const current = (await this.channel.object.get()) as Record<
      string,
      unknown
    > | null;
    const ops: RestObjectOperation[] = [];
    if (!current || current.days === undefined) {
      ops.push({
        path: "days",
        mapCreate: { semantics: "lww", entries: {} },
      });
    }
    if (!current || current.destinations === undefined) {
      ops.push({
        path: "destinations",
        mapCreate: { semantics: "lww", entries: {} },
      });
    }
    if (!current || current.budget === undefined) {
      ops.push({ path: "budget", counterCreate: { count: 0 } });
    }
    if (ops.length > 0) {
      await this.channel.object.publish(ops);
    }
  }

  async setMeta(meta: TripMeta): Promise<void> {
    await this.channel.object.publish({
      path: "",
      mapSet: { key: "meta", value: { json: { ...meta } } },
    });
  }

  async addDay(
    dayId: string,
    index: number,
    title: string,
    date?: string,
  ): Promise<void> {
    await this.channel.object.publish({
      path: `days.${dayId}`,
      mapCreate: {
        semantics: "lww",
        entries: {
          title: { data: { string: title } },
          index: { data: { number: index } },
          ...(date ? { date: { data: { string: date } } } : {}),
        },
      },
    });
  }

  async addStop(dayId: string, stop: Stop): Promise<void> {
    const ops: RestObjectOperation[] = [
      {
        path: `days.${dayId}`,
        mapSet: {
          key: `stop:${stop.id}`,
          value: { json: { ...stop } },
        },
      },
    ];
    if (stop.price && stop.price > 0) {
      ops.push({ path: "budget", counterInc: { number: stop.price } });
    }
    await this.channel.object.publish(ops);
  }

  async addDestination(destination: Destination): Promise<void> {
    await this.channel.object.publish({
      path: "destinations",
      mapSet: {
        key: destination.id,
        value: { json: { ...destination } },
      },
    });
  }
}
