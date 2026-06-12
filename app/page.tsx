"use client";

import { useRouter } from "next/navigation";

import { newTripId } from "@/lib/trip-id";

export default function Home() {
  const router = useRouter();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-12 text-center sm:p-8 dark:bg-zinc-950">
      <div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Wayfarer
        </h1>
        <p className="mt-3 max-w-md text-zinc-500 dark:text-zinc-400">
          An AI travel planning canvas. Chat directs the AI; the canvas is
          where it works.
        </p>
      </div>
      <button
        onClick={() => router.push(`/trip/${newTripId()}`)}
        className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Start planning a trip
      </button>
      <p className="max-w-sm text-xs text-zinc-400 dark:text-zinc-500">
        One prompt fills a live map, day-by-day itinerary, and budget. Your
        trip lives at its own link — reopen it anytime, or share it and plan
        together in realtime.
      </p>
    </main>
  );
}
