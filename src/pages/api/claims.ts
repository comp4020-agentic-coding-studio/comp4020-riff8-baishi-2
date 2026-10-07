import type { APIRoute } from "astro";
import { makeClaim } from "../../lib/claims";
import { json, readBody, text } from "../../lib/http";

// Claiming happens when the brush first goes down, not when the mark is
// saved: the server hands out the lowest strip nobody has saved into or
// holds, so two people who start together get two strips and neither is
// ever refused for being slow. The token is the only identity there is.
export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, 1024);
  if (body instanceof Response) return body;
  const idleMs = typeof body.idleMs === "number" ? body.idleMs : undefined;
  const claim = makeClaim(idleMs);
  if (!claim) return text("every strip is busy right now; try again in a minute", 503);
  return json({ token: claim.token, strip: claim.strip, idleMs: claim.idleMs }, 201);
};
