/**
 * Formato del mazo suscrito (skola-feed/1).
 *
 * El feed es la fuente de verdad de sus tarjetas: cada nota tiene un id estable,
 * y al sincronizar se crean las nuevas, se actualizan las cambiadas (sin tocar el
 * progreso FSRS de sus tarjetas) y se borran las que ya no están en el feed.
 */
export const FEED_FORMAT = "skola-feed/1";

export interface FeedDeck {
  /** Clave estable del mazo dentro del feed (p. ej. "tobe"). */
  key: string;
  name: string;
  /** Clave del mazo padre; si falta, cuelga del mazo raíz del feed. */
  parent?: string;
  description?: string;
}

export interface FeedNoteBase {
  /** Id estable de la nota dentro del feed. */
  id: string;
  /** Clave del mazo; si falta, va al mazo raíz del feed. */
  deck?: string;
  tags?: string[];
  /** De dónde sale (documento, sección, reunión). Solo informativo. */
  source?: string;
}

export interface FeedBasicNote extends FeedNoteBase {
  type: "basic";
  front: string;
  back: string;
}

export interface FeedClozeNote extends FeedNoteBase {
  type: "cloze";
  /** Texto HTML con huecos {{c1::…}}. */
  text: string;
}

export type FeedNote = FeedBasicNote | FeedClozeNote;

export interface Feed {
  format: typeof FEED_FORMAT;
  /** Nombre del mazo raíz que se crea en Skola. */
  name: string;
  updatedAt?: string;
  decks: FeedDeck[];
  notes: FeedNote[];
}

export interface Subscription {
  /** Identificador local (slug) que prefija los ids de mazos y notas. */
  id: string;
  url: string;
  token?: string;
  name?: string;
  autoSync: boolean;
  lastSync?: string;
  lastResult?: string;
  lastError?: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  moved: number;
  deleted: number;
  decks: number;
}

export function parseFeed(raw: unknown): Feed {
  if (!raw || typeof raw !== "object")
    throw new Error("El feed no es un objeto JSON");
  const f = raw as Partial<Feed>;
  if (f.format !== FEED_FORMAT)
    throw new Error(`Formato no soportado: ${String(f.format)}`);
  if (typeof f.name !== "string" || !f.name.trim())
    throw new Error("Al feed le falta el nombre");
  if (!Array.isArray(f.decks) || !Array.isArray(f.notes))
    throw new Error("Al feed le faltan decks o notes");
  const deckKeys = new Set<string>();
  for (const d of f.decks) {
    if (!d || typeof d.key !== "string" || typeof d.name !== "string")
      throw new Error("Mazo mal formado en el feed");
    if (deckKeys.has(d.key)) throw new Error(`Mazo repetido: ${d.key}`);
    deckKeys.add(d.key);
  }
  for (const d of f.decks) {
    if (d.parent && !deckKeys.has(d.parent))
      throw new Error(
        `El mazo ${d.key} apunta a un padre inexistente: ${d.parent}`
      );
  }
  const noteIds = new Set<string>();
  for (const n of f.notes) {
    if (!n || typeof n.id !== "string" || !n.id)
      throw new Error("Nota sin id en el feed");
    if (noteIds.has(n.id)) throw new Error(`Nota repetida: ${n.id}`);
    noteIds.add(n.id);
    if (n.deck && !deckKeys.has(n.deck))
      throw new Error(
        `La nota ${n.id} apunta a un mazo inexistente: ${n.deck}`
      );
    if (n.type === "basic") {
      if (typeof n.front !== "string" || typeof n.back !== "string")
        throw new Error(`Nota ${n.id}: faltan front/back`);
    } else if (n.type === "cloze") {
      if (typeof n.text !== "string" || clozeNumbers(n.text).length === 0)
        throw new Error(`Nota ${n.id}: cloze sin huecos {{cN::…}}`);
    } else {
      throw new Error(`Nota ${(n as FeedNoteBase).id}: tipo no soportado`);
    }
  }
  return f as Feed;
}

/** Números de hueco presentes en un texto cloze, ordenados y sin repetir. */
export function clozeNumbers(text: string): number[] {
  const found: number[] = [];
  const re = /\{\{c(\d+)::/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const n = Number(m[1]);
    if (!found.includes(n)) found.push(n);
    m = re.exec(text);
  }
  return found.sort((a, b) => a - b);
}

/** Orden de creación de mazos: primero los padres. */
export function orderDecks(decks: FeedDeck[]): FeedDeck[] {
  const byKey = new Map(decks.map((d) => [d.key, d]));
  const out: FeedDeck[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (d: FeedDeck) => {
    if (done.has(d.key)) return;
    if (visiting.has(d.key)) throw new Error(`Ciclo de mazos en ${d.key}`);
    visiting.add(d.key);
    if (d.parent) visit(byKey.get(d.parent)!);
    visiting.delete(d.key);
    done.add(d.key);
    out.push(d);
  };
  decks.forEach(visit);
  return out;
}
