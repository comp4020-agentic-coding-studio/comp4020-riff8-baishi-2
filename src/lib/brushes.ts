// The fixed set of brushes and inks a visitor chooses from, shared by the
// server (validation, rendering) and the client (the tray, wet ink). The
// lists are short on purpose: see README.md on why there's no colour picker.

export const INKS = {
  jiao: { name: "scorched ink", han: "焦墨", hex: "#1d1b19" },
  nong: { name: "dense ink", han: "浓墨", hex: "#3a3631" },
  zhong: { name: "heavy ink", han: "重墨", hex: "#5e5850" },
  dan: { name: "light ink", han: "淡墨", hex: "#8f877c" },
  indigo: { name: "indigo", han: "花青", hex: "#2f4f6f" },
  ochre: { name: "ochre", han: "赭石", hex: "#9a5b2e" },
  malachite: { name: "malachite", han: "石绿", hex: "#3e7a64" },
} as const;

// min/max: the core stroke width range. halo: how many times wider the soft
// halo is than the core. spread: how far, in core widths, the ink reaches
// from its path in all — the halo, plus the wash's blur (ink.ts's BLEED,
// which needs w >= 24 to fit) — which is what zoneBounds checks against.
// core: the dry core stroke's opacity.
export const BRUSHES = {
  broad: { name: "soft goat-hair", han: "羊毫", min: 3, max: 14, halo: 1.8, spread: 1.8, core: 0.9 },
  fine: { name: "wolf-hair liner", han: "狼毫", min: 1.5, max: 5, halo: 1.3, spread: 1.3, core: 0.95 },
  dry: { name: "flying white", han: "飞白", min: 6, max: 16, halo: 1.3, spread: 1.4, core: 0.9 },
  wash: { name: "wet wash", han: "泼墨", min: 24, max: 40, halo: 1.4, spread: 2.2, core: 0.3 },
} as const;

export type InkId = keyof typeof INKS;
export type BrushId = keyof typeof BRUSHES;

export const DEFAULT_INK: InkId = "jiao";
export const DEFAULT_BRUSH: BrushId = "broad";

// Every mark's halo is its own ink at this alpha: the one the original
// single-ink scroll used for its soft edge.
export const HALO_ALPHA = 0.22;
// Wet (unpublished) ink, as everyone else sees it.
export const WET_ALPHA = 0.45;

export function isInk(id: unknown): id is InkId {
  return typeof id === "string" && Object.hasOwn(INKS, id);
}

export function isBrush(id: unknown): id is BrushId {
  return typeof id === "string" && Object.hasOwn(BRUSHES, id);
}

// The widest any stroke of this brush can reach from its path, halo
// included: what a client clamps its pointer to so it never needs refusing.
export function maxReach(brush: BrushId): number {
  return (BRUSHES[brush].max * BRUSHES[brush].spread) / 2;
}
