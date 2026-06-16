import {
  getToolName,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";

type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;
type UIPart = UIMessage["parts"][number];

// A tool call is only safe to replay to the model once it has produced a
// result. A part still in "input-streaming" or "input-available" (or awaiting
// an approval decision) belongs to a turn that was interrupted mid-call (the
// user hit Stop, the request aborted, or the serverless function timed out) and
// was then persisted to the channel. It has no matching tool result, which
// Anthropic rejects, so it must not reach the model.
function isCompleteToolPart(part: AnyToolUIPart): boolean {
  return part.state === "output-available" || part.state === "output-error";
}

// Anthropic requires an `input` object on every assistant `tool_use` block,
// even an empty one. A *completed* tool call (it ran and produced a result) can
// still be rehydrated from channel history with `input` missing: when the
// model's arguments were an empty object `{}`, no input-delta text streams, so
// the reconstruction decodes the empty accumulated input back to `undefined`
// rather than `{}`. `convertToModelMessages` then forwards that `undefined`
// straight into the `tool_use` block (its "output-available" branch has no
// `input` fallback, unlike "output-error"), and Anthropic rejects the whole
// request with `messages.<n>.content.0.tool_use.input: Field required`. Because
// the offending turn lives in durable history, once it appears every later turn
// on the trip 400s the same way until the gap is filled. Restoring `{}` keeps
// the real prior call (its arguments genuinely were empty) instead of dropping
// it (AIT-992).
function hasUsableInput(part: AnyToolUIPart): boolean {
  return typeof part.input === "object" && part.input !== null;
}

// Whether an (already tool-filtered) assistant part still carries something the
// model can use, so we can drop messages left empty after stripping a call.
function isUsablePart(part: UIPart): boolean {
  if (isTextUIPart(part)) return Boolean(part.text && part.text.trim());
  if (isReasoningUIPart(part)) return true;
  return isToolUIPart(part); // only complete tool parts survive the strip above
}

/** A tool call that was dropped from the conversation, for diagnostics. */
export interface DroppedToolCall {
  messageIndex: number;
  messageId: string;
  type: string;
  state?: string;
  toolName?: string;
}

/** A tool call whose missing `input` was backfilled with `{}`, for diagnostics. */
export interface RepairedToolCall {
  messageIndex: number;
  messageId: string;
  type: string;
  state?: string;
  toolName?: string;
}

export interface SanitizedConversation {
  messages: UIMessage[];
  dropped: DroppedToolCall[];
  repaired: RepairedToolCall[];
}

/**
 * Make a conversation reconstructed from the channel safe to hand to the model.
 * The channel is the only conversation record (there is no database), so a
 * later turn replays every earlier turn's tool calls verbatim, and two kinds
 * of malformed `tool_use` block, persisted in durable history, will otherwise
 * make Anthropic reject every subsequent request on the trip with a 400:
 *
 *  - **Interrupted calls**: a turn cancelled or timed out mid-tool-call leaves
 *    a half-formed call (still `input-streaming` / `input-available`, no
 *    result). Dropped here.
 *  - **Completed calls with no `input`**: a finished call whose arguments were
 *    `{}` rehydrates with `input` absent (`tool_use.input: Field required`).
 *    Backfilled with `{}` here, preserving the real call (AIT-992).
 *
 * Returns the cleaned messages plus a record of what was dropped and repaired,
 * so the caller can log it.
 */
export function sanitizeConversation(
  messages: UIMessage[],
): SanitizedConversation {
  const dropped: DroppedToolCall[] = [];
  const repaired: RepairedToolCall[] = [];

  const cleaned = messages.map((message, messageIndex) => {
    if (message.role !== "assistant") return message;
    const parts = message.parts
      .filter((part) => {
        if (!isToolUIPart(part) || isCompleteToolPart(part)) return true;
        dropped.push({
          messageIndex,
          messageId: message.id,
          type: part.type,
          state: part.state,
          toolName: getToolName(part),
        });
        return false;
      })
      .map((part) => {
        // Every surviving tool part is complete; ensure it carries an `input`
        // object so the reconstructed `tool_use` block is well-formed.
        if (!isToolUIPart(part) || hasUsableInput(part)) return part;
        repaired.push({
          messageIndex,
          messageId: message.id,
          type: part.type,
          state: part.state,
          toolName: getToolName(part),
        });
        return { ...part, input: {} };
      });
    return { ...message, parts };
  });

  // A message whose only content was the interrupted call is now empty; drop it
  // so we never send a contentless assistant turn.
  const kept = cleaned.filter(
    (message) =>
      message.role !== "assistant" || message.parts.some(isUsablePart),
  );

  return { messages: kept, dropped, repaired };
}
