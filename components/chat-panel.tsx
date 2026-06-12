"use client";

import { useChat } from "@ai-sdk/react";
import {
  ChatTransportProvider,
  useChatTransport,
  useMessageSync,
  useView,
} from "@ably/ai-transport/vercel/react";
import type { UIMessage } from "ai";
import { useContext, useEffect, useRef, useState } from "react";

import { RealtimeReadyContext } from "@/components/trip-realtime-provider";
import { sessionChannelName } from "@/lib/channels";
import { getVisitorId } from "@/lib/visitor";

// One-tap example prompts shown on a fresh trip so a cold demo starts without
// anyone having to think of what to type. Picking one sends it immediately.
const SEED_PROMPTS = [
  "Plan a long weekend in Lisbon",
  "5 days in Tokyo for first-timers",
  "A relaxed week in the Amalfi Coast",
] as const;

interface ToolPart {
  type: string;
  toolName?: string;
  state?: string;
  input?: Record<string, unknown>;
}

function toolPartsOf(message: UIMessage): ToolPart[] {
  return message.parts.filter(
    (part) => part.type === "dynamic-tool" || part.type.startsWith("tool-"),
  ) as unknown as ToolPart[];
}

// Live feedback while the AI works the canvas: each tool call renders as an
// activity line that appears as soon as the call starts streaming in.
function ToolActivity({ part }: { part: ToolPart }) {
  const input = part.input ?? {};
  const toolName =
    part.toolName ?? part.type.replace(/^tool-/, "").replace(/^dynamic-/, "");
  const label = (() => {
    switch (toolName) {
      case "set_trip_meta":
        return input.title ? `Trip: ${String(input.title)}` : "Naming the trip…";
      case "add_destination":
        return input.name
          ? `Pinning ${String(input.name)} on the map`
          : "Adding a destination…";
      case "add_day":
        return input.title ? String(input.title) : "Adding a day…";
      case "add_stop":
        return input.name
          ? `Adding ${String(input.name)}`
          : "Adding a stop…";
      case "web_search":
        return input.query
          ? `Searching: ${String(input.query)}`
          : "Searching the web…";
      default:
        return toolName;
    }
  })();
  const done =
    part.state === "output-available" || part.state === "output-error";
  return (
    <span className="flex items-center gap-1.5 px-1 text-xs text-zinc-500 dark:text-zinc-400">
      <span
        aria-hidden
        className={done ? "text-emerald-500" : "animate-pulse text-zinc-400"}
      >
        {done ? "✓" : "◌"}
      </span>
      {label}
    </span>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  const toolParts = isUser ? [] : toolPartsOf(message);
  if (!text && toolParts.length === 0) {
    return null;
  }
  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      {toolParts.length > 0 && (
        <div className="flex flex-col gap-0.5 py-0.5">
          {toolParts.map((part, i) => (
            <ToolActivity key={i} part={part} />
          ))}
        </div>
      )}
      {text && (
        <div
          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
            isUser
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
          }`}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function ChatInner({ tripId }: { tripId: string }) {
  const { chatTransport } = useChatTransport();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, setMessages, sendMessage, stop, status } = useChat({
    id: tripId,
    transport: chatTransport,
  });

  // Sync channel state (history, other participants, resumed streams) into
  // useChat, and auto-load the most recent history on mount.
  useMessageSync({ setMessages });
  useView({ limit: 30 });

  const isStreaming = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        {messages.length === 0 && (
          <div className="m-auto flex max-w-xs flex-col items-center gap-3 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Tell the AI where you want to go, and watch the map, itinerary,
              and budget fill in live. Try one of these:
            </p>
            <div className="flex flex-col gap-2">
              {SEED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => void sendMessage({ text: prompt })}
                  className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {status === "submitted" && (
          <p className="px-1 text-xs text-zinc-400 animate-pulse">Thinking…</p>
        )}
      </div>
      <form
        className="flex gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text || isStreaming) return;
          setInput("");
          void sendMessage({ text });
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Where to?"
          className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-transparent px-4 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="shrink-0 rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="shrink-0 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

// The chat panel content. Requires a mounted AblyProvider, so it renders a
// placeholder until the realtime provider is ready.
export function ChatPanel({ tripId }: { tripId: string }) {
  const ready = useContext(RealtimeReadyContext);

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-400 dark:text-zinc-500">
        Connecting…
      </div>
    );
  }

  return (
    <ChatTransportProvider
      channelName={sessionChannelName(tripId)}
      clientId={getVisitorId()}
      api="/api/chat"
    >
      <ChatInner tripId={tripId} />
    </ChatTransportProvider>
  );
}
