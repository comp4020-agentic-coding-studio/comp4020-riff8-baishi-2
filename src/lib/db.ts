import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_BRUSH, DEFAULT_INK } from "./brushes";
import type { StrokeData } from "./ink";

// /data is the one thing Fly's volume gives us (see fly.toml); everywhere
// else (local dev, CI's throwaway container) falls back to a working-tree
// path that's gitignored.
const DB_PATH = process.env.DB_PATH ?? "./.data/scroll.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// One published mark is one row, so the row count is the count of visits
// that left a mark. Nothing here ever updates or deletes a row — see
// CLAUDE.md. The table keeps its original name and its original `d`/`width`
// columns: rows from before multi-stroke marks are one-stroke marks in the
// default brush and ink.
db.exec(`
  CREATE TABLE IF NOT EXISTS strokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    d TEXT NOT NULL,
    width REAL NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
const columns = new Set(
  (db.prepare("PRAGMA table_info(strokes)").all() as { name: string }[]).map((c) => c.name),
);
// `strip`: which strip the mark sits in. `marks`: the mark's strokes as JSON.
// Both are NULL on older rows, whose strip is derived on read instead of
// backfilled by an UPDATE (an older row's strip was always its position).
if (!columns.has("strip")) db.exec("ALTER TABLE strokes ADD COLUMN strip INTEGER");
if (!columns.has("marks")) db.exec("ALTER TABLE strokes ADD COLUMN marks TEXT");

export interface Mark {
  id: number;
  strip: number;
  number: number;
  strokes: StrokeData[];
  createdAt: number;
}

interface Row {
  id: number;
  d: string;
  width: number;
  createdAt: number;
  strip: number;
  number: number;
  marks: string | null;
}

const insertStmt = db.prepare(
  "INSERT INTO strokes (d, width, created_at, strip, marks) VALUES ('', 0, ?, ?, ?)",
);
const countStmt = db.prepare("SELECT COUNT(*) AS n FROM strokes");
const selectStmt = db.prepare(`
  SELECT id, d, width, created_at AS createdAt, marks, number,
         CASE WHEN strip IS NULL THEN number - 1 ELSE strip END AS strip
  FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY id) AS number FROM strokes)
  WHERE id > ?
  ORDER BY id ASC
`);

// Generous caps, not design constraints: they exist only so one request
// can't hand the server an unbounded string or an endless mark.
export const MAX_D_LENGTH = 20_000;
export const MAX_STROKES = 24;

function toMark(row: Row): Mark {
  const strokes: StrokeData[] = row.marks
    ? JSON.parse(row.marks)
    : [{ d: row.d, width: row.width, brush: DEFAULT_BRUSH, ink: DEFAULT_INK }];
  return { id: row.id, strip: row.strip, number: row.number, strokes, createdAt: row.createdAt };
}

export function countMarks(): number {
  return (countStmt.get() as { n: number }).n;
}

export function getMarks(sinceId = 0): Mark[] {
  return (selectStmt.all(sinceId) as Row[]).map(toMark);
}

export function savedStrips(): Set<number> {
  return new Set(getMarks().map((m) => m.strip));
}

// A bare "M x y" has no paintable geometry in SVG — a browser silently
// renders nothing for it. The client never emits one, but the data layer is
// the one place this promise (every saved stroke is visible) can be held
// regardless of what any future client sends.
const BARE_MOVETO = /^M\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s*$/;

export function paintable(d: string): string {
  const bare = d.match(BARE_MOVETO);
  return bare ? `${d} L ${bare[1]} ${bare[2]}` : d;
}

// The whole mark in one INSERT: every stroke lands, or none does.
export const addMark = db.transaction((strip: number, strokes: StrokeData[]): Mark => {
  if (savedStrips().has(strip)) throw new Error(`strip ${strip} already holds a mark`);
  const safe = strokes.map((s) => ({ ...s, d: paintable(s.d) }));
  const createdAt = Date.now();
  const info = insertStmt.run(createdAt, strip, JSON.stringify(safe));
  return {
    id: Number(info.lastInsertRowid),
    strip,
    number: countMarks(),
    strokes: safe,
    createdAt,
  };
});
