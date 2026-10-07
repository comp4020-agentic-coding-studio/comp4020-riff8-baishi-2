import type { APIRoute } from "astro";
import { findClaim, liftWet } from "../../lib/claims";
import { json, readBody, text } from "../../lib/http";

// Blotting wet ink off the paper: lifts one whole stroke from the caller's
// own claim. It can only find strokes under the token it's given, so it
// can't reach anyone else's wet ink, and a published mark has no claim left
// to find — there is no path from here to a saved row.
export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, 1024);
  if (body instanceof Response) return body;
  const claim = findClaim(body.token);
  if (!claim) return text("you hold no strip (or your claim lapsed)", 403);
  if (typeof body.stroke !== "string" || !liftWet(claim, body.stroke))
    return text("no wet stroke by that id under your claim", 404);
  return json({ lifted: body.stroke, idleMs: claim.idleMs });
};
