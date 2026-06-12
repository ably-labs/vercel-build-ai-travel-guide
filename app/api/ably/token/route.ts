import Ably from "ably";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Issues short-lived Ably token requests to the browser. The API key never
// leaves the server. The token carries the visitor's clientId so presence and
// message authorship are attributable, and its capabilities are scoped to the
// trip:* namespace (publish/subscribe/presence, history for replay on reload,
// and the object capabilities LiveObjects needs).
export async function GET(request: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ABLY_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId || !/^[\w-]{1,64}$/.test(clientId)) {
    return NextResponse.json(
      { error: "A valid clientId query parameter is required" },
      { status: 400 },
    );
  }

  const rest = new Ably.Rest({ key: apiKey });
  const tokenRequest = await rest.auth.createTokenRequest({
    clientId,
    capability: {
      "trip:*": [
        "publish",
        "subscribe",
        "presence",
        "history",
        "object-publish",
        "object-subscribe",
      ],
    },
  });

  return NextResponse.json(tokenRequest);
}
