// The museum label under the scroll, shared by the server render and the
// live client so both say it the same way.

export function marksLabel(count: number, firstAt: number | null): string {
  if (count === 0 || firstAt === null)
    return "Nobody has painted yet. The bright strip at the right is where you go first.";
  const since = new Date(firstAt).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `${count} mark${count === 1 ? "" : "s"} so far, since ${since}.`;
}

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

// Not a presence counter: the label noticing wet ink on the paper.
export function drawingNow(held: number): string {
  if (held === 0) return "";
  const n = WORDS[held] ?? String(held);
  return held === 1 ? "One person is painting now." : `${n} people are painting now.`;
}
