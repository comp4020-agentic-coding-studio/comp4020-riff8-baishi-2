// The in-memory fan-out behind /api/events: one process on one machine, so a
// set of subscribers is the whole real-time layer. Nothing here is saved;
// see docs/adr/0001-concurrent-drawers.md for what that costs.

type Send = (chunk: Uint8Array) => void;

interface Bus {
  subscribers: Set<Send>;
  heartbeat: ReturnType<typeof setInterval> | null;
}

// One bus per process, even if a dev server loads this module twice.
const bus: Bus = ((globalThis as Record<string, unknown>).__scrollBus as Bus | undefined) ?? {
  subscribers: new Set(),
  heartbeat: null,
};
(globalThis as Record<string, unknown>).__scrollBus = bus;

// Enough for a room full of phones; a cap so one script can't hold open
// thousands of streams on a 256 MB machine.
export const MAX_SUBSCRIBERS = 200;
// Fly's proxy drops a stream that's silent for too long.
const HEARTBEAT_MS = 20_000;

export function format(event: string, data: unknown, id?: number): string {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

export function broadcast(event: string, data: unknown, id?: number): void {
  const chunk = encoder.encode(format(event, data, id));
  for (const send of bus.subscribers) send(chunk);
}

export function subscribe(send: Send): (() => void) | null {
  if (bus.subscribers.size >= MAX_SUBSCRIBERS) return null;
  bus.subscribers.add(send);
  if (!bus.heartbeat) {
    bus.heartbeat = setInterval(() => {
      const beat = encoder.encode(": heartbeat\n\n");
      for (const s of bus.subscribers) s(beat);
    }, HEARTBEAT_MS);
    bus.heartbeat.unref();
  }
  return () => {
    bus.subscribers.delete(send);
    if (bus.subscribers.size === 0 && bus.heartbeat) {
      clearInterval(bus.heartbeat);
      bus.heartbeat = null;
    }
  };
}
