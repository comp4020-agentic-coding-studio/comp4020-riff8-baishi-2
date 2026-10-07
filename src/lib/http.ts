// Small helpers shared by the API endpoints.
import { DEFAULT_BRUSH, DEFAULT_INK, isBrush, isInk, type BrushId, type InkId } from "./brushes";

export function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Reads a JSON object body no bigger than `maxBytes`, or returns the
// Response that refuses it.
export async function readBody(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | Response> {
  const raw = await request.text();
  if (raw.length > maxBytes) return text("request body too large", 413);
  try {
    const body: unknown = JSON.parse(raw);
    if (typeof body === "object" && body !== null && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  return text("expected a JSON object body", 400);
}

// An absent brush or ink means the default; anything not on the lists is
// refused rather than quietly replaced.
export function brushAndInk(
  body: Record<string, unknown>,
): { brush: BrushId; ink: InkId } | Response {
  const brush = body.brush ?? DEFAULT_BRUSH;
  const ink = body.ink ?? DEFAULT_INK;
  if (!isBrush(brush)) return text(`unknown brush "${String(brush)}"`, 400);
  if (!isInk(ink)) return text(`unknown ink "${String(ink)}"`, 400);
  return { brush, ink };
}

export const STROKE_ID = /^[a-z0-9]{1,16}$/;
