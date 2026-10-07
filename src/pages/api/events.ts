import type { APIRoute } from "astro";
import { snapshot } from "../../lib/claims";
import { countMarks, getMarks } from "../../lib/db";
import { format, subscribe } from "../../lib/live";

// How far (in bytes) a viewer may fall behind before it's dropped; it
// reconnects and catches up by Last-Event-ID.
const MAX_BEHIND = 1024 * 1024;

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
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const close = (): void => {
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        // A viewer that stops reading is dropped rather than buffered
        // for: its queue would otherwise grow with every broadcast.
        const send = (chunk: Uint8Array): void => {
          if ((controller.desiredSize ?? 0) < -MAX_BEHIND) return close();
          try {
            controller.enqueue(chunk);
          } catch {
            close();
          }
        };
        const sendText = (s: string): void => send(encoder.encode(s));
        if (request.signal.aborted) return close();
        unsubscribe = subscribe(send);
        if (!unsubscribe) {
          // Full: tell the client to back off for a while, not hammer.
          sendText("retry: 30000\n\n" + format("full", {}));
          return close();
        }
        sendText("retry: 2000\n\n");
        for (const mark of getMarks(Math.max(0, since))) sendText(format("mark", mark, mark.id));
        sendText(format("hello", { claims: snapshot(), count: countMarks() }));
        request.signal.addEventListener("abort", close);
      },
      cancel() {
        unsubscribe?.();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 }),
  );

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
};
