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

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  if (!text) {
    return null;
  }
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {text}
      </div>
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
          <p className="m-auto max-w-60 text-center text-sm text-zinc-400 dark:text-zinc-500">
            Tell the AI where you want to go — try &ldquo;Plan me a long
            weekend in Lisbon&rdquo;
          </p>
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
          className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-transparent px-4 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
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
