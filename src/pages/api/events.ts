import type { APIRoute } from "astro";
import { snapshot } from "../../lib/claims";
import { countMarks, getMarks } from "../../lib/db";
import { format, subscribe } from "../../lib/live";
import { text } from "../../lib/http";

// The real-time stream: server-sent events, since the traffic is almost all
// server-to-client and there's one process to fan out from. On every
// (re)connect a viewer first gets any marks published since the last one it
// saw (Last-Event-ID, or ?since= on the first connect), then the room as it
// is now: held strips and their wet ink.
export const GET: APIRoute = ({ request, url }) => {
  const header = Number(request.headers.get("last-event-id"));
  const query = Number(url.searchParams.get("since"));
  const since = Number.isInteger(header) && header > 0 ? header : Number.isInteger(query) ? query : 0;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string): void => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          unsubscribe?.();
        }
      };
      unsubscribe = subscribe(send);
      if (!unsubscribe) {
        controller.enqueue(encoder.encode(format("full", {})));
        controller.close();
        return;
      }
      send("retry: 2000\n\n");
      for (const mark of getMarks(Math.max(0, since))) send(format("mark", mark, mark.id));
      send(format("hello", { claims: snapshot(), count: countMarks() }));
      request.signal.addEventListener("abort", () => {
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  if (request.signal.aborted) return text("gone", 499);
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
};
