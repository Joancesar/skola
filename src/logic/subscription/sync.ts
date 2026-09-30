import { getAdapterOfType } from "../NoteTypeAdapter";
import { Card } from "../card/card";
import { createCardSkeleton } from "../card/createCardSkeleton";
import { newCard } from "../card/newCard";
import { db } from "../db";
import { invalidateDeckStatsCache } from "../deck/deckStatsCacheManager";
import { NoteContent } from "../note/NoteContent";
import { moveNote } from "../note/moveNote";
import { Note, NoteType } from "../note/note";
import { updateNoteContent } from "../note/updateNoteContent";
import { patchSubscription } from "./storage";
import {
  Feed,
  FeedNote,
  Subscription,
  SyncResult,
  clozeNumbers,
  orderDecks,
  parseFeed,
} from "./types";

export const rootDeckId = (sub: Subscription) => `sub-${sub.id}-root`;
const deckId = (sub: Subscription, key?: string) =>
  key ? `sub-${sub.id}-d-${key}` : rootDeckId(sub);
const noteId = (sub: Subscription, id: string) => `sub-${sub.id}-n-${id}`;

export async function fetchFeed(sub: Subscription): Promise<Feed> {
  const res = await fetch(sub.url, {
    headers: sub.token ? { Authorization: `Bearer ${sub.token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  return parseFeed(await res.json());
}

/** Crea el mazo con un id fijo (como newDeck) o lo renombra si ya existe. */
async function ensureDeck(
  id: string,
  name: string,
  parentId?: string,
  description?: string
) {
  const existing = await db.decks.get(id);
  if (existing) {
    if (existing.name !== name || existing.description !== description) {
      await db.decks.update(id, { name, description });
    }
    return false;
  }
  const parent = parentId ? await db.decks.get(parentId) : undefined;
  if (parentId && !parent) {
    throw new Error(`No existe el mazo padre ${parentId}`);
  }
  await db.transaction("rw", db.decks, async () => {
    if (parent) {
      await db.decks.update(parent.id, {
        subDecks: [...(parent.subDecks ?? []), id],
      });
    }
    await db.decks.add({
      id,
      name,
      description,
      cards: [],
      notes: [],
      subDecks: [],
      superDecks: parent
        ? [...(parent.superDecks ?? []), parent.id]
        : undefined,
      options: { newToReviewRatio: 0.5, dailyNewCards: 25 },
    });
  });
  return true;
}

function toContent(n: FeedNote): NoteContent<NoteType> {
  return n.type === "basic"
    ? { type: NoteType.Basic, front: n.front, back: n.back }
    : { type: NoteType.Cloze, text: n.text };
}

async function addCards(noteId: string, n: FeedNote, deckId: string) {
  const contents =
    n.type === "basic"
      ? [{ type: NoteType.Basic }]
      : clozeNumbers(n.text).map((occlusionNumber) => ({
          type: NoteType.Cloze,
          occlusionNumber,
        }));
  for (const content of contents) {
    // newCard añade la tarjeta y actualiza deck.cards; se relee el mazo cada vez.
    const deck = await db.decks.get(deckId);
    if (!deck) throw new Error(`No existe el mazo ${deckId}`);
    await newCard(
      { ...createCardSkeleton(), note: noteId, content } as Card<NoteType>,
      deck
    );
  }
}

/** Como newNote + createNote del tipo, pero con el id fijo que da el feed. */
async function createNote(id: string, n: FeedNote, targetDeckId: string) {
  const content = toContent(n);
  await db.transaction("rw", db.decks, db.notes, async () => {
    const deck = await db.decks.get(targetDeckId);
    if (!deck) throw new Error(`No existe el mazo ${targetDeckId}`);
    await db.notes.add({
      id,
      deck: deck.id,
      creationDate: new Date(),
      linkedNotes: [],
      content,
      sortField: getAdapterOfType(content.type).getSortFieldFromNoteContent(
        content
      ),
    });
    await db.decks.update(deck.id, { notes: [...deck.notes, id] });
  });
  await addCards(id, n, targetDeckId);
}

/** Borra una nota y sus tarjetas, dejando coherentes las listas del mazo. */
async function removeNote(note: Note<NoteType>) {
  await db.transaction("rw", db.notes, db.cards, db.decks, async () => {
    const cardIds = (await db.cards
      .where("note")
      .equals(note.id)
      .primaryKeys()) as string[];
    await db.cards.bulkDelete(cardIds);
    await db.notes.delete(note.id);
    const deck = await db.decks.get(note.deck);
    if (deck) {
      await db.decks.update(deck.id, {
        notes: deck.notes.filter((n) => n !== note.id),
        cards: deck.cards.filter((c) => !cardIds.includes(c)),
      });
    }
  });
  await invalidateDeckStatsCache(note.deck);
}

type UpdateOutcome = "unchanged" | "updated" | "recreate";

/**
 * Actualiza el contenido conservando las tarjetas y su progreso FSRS. En un cloze
 * cuyo juego de huecos cambia se añaden las tarjetas nuevas y se quitan las que
 * sobran. Si la nota cambia de tipo (básica ↔ cloze) hay que recrearla.
 */
async function updateNote(
  existing: Note<NoteType>,
  n: FeedNote
): Promise<UpdateOutcome> {
  // biome-ignore lint/suspicious/noExplicitAny: el contenido depende del tipo
  const c = existing.content as any;
  const wantedType = n.type === "basic" ? NoteType.Basic : NoteType.Cloze;
  if (c.type !== wantedType) return "recreate";
  if (n.type === "basic") {
    if (c.front === n.front && c.back === n.back) return "unchanged";
    await updateNoteContent(existing.id, toContent(n));
    return "updated";
  }
  if (c.text === n.text) return "unchanged";
  await updateNoteContent(existing.id, toContent(n));
  const wanted = clozeNumbers(n.text);
  const cards = await db.cards.where("note").equals(existing.id).toArray();
  const have = cards.map(
    // biome-ignore lint/suspicious/noExplicitAny: contenido de tarjeta cloze
    (card) => (card.content as any).occlusionNumber as number
  );
  for (const num of wanted) {
    if (!have.includes(num)) {
      const deck = await db.decks.get(existing.deck);
      if (!deck) break;
      await newCard(
        {
          ...createCardSkeleton(),
          note: existing.id,
          content: { type: NoteType.Cloze, occlusionNumber: num },
        } as Card<NoteType>,
        deck
      );
    }
  }
  const extra = cards
    // biome-ignore lint/suspicious/noExplicitAny: contenido de tarjeta cloze
    .filter((card) => !wanted.includes((card.content as any).occlusionNumber))
    .map((card) => card.id);
  if (extra.length) {
    await db.transaction("rw", db.cards, db.decks, async () => {
      await db.cards.bulkDelete(extra);
      const deck = await db.decks.get(existing.deck);
      if (deck) {
        await db.decks.update(deck.id, {
          cards: deck.cards.filter((id) => !extra.includes(id)),
        });
      }
    });
  }
  await invalidateDeckStatsCache(existing.deck);
  return "updated";
}

export async function applyFeed(
  sub: Subscription,
  feed: Feed
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    moved: 0,
    deleted: 0,
    decks: 0,
  };
  if (await ensureDeck(rootDeckId(sub), feed.name)) result.decks++;
  for (const d of orderDecks(feed.decks)) {
    const created = await ensureDeck(
      deckId(sub, d.key),
      d.name,
      deckId(sub, d.parent),
      d.description
    );
    if (created) result.decks++;
  }

  const seen = new Set<string>();
  for (const n of feed.notes) {
    const id = noteId(sub, n.id);
    const target = deckId(sub, n.deck);
    seen.add(id);
    const existing = await db.notes.get(id);
    if (!existing) {
      await createNote(id, n, target);
      result.created++;
      continue;
    }
    if (existing.deck !== target) {
      await moveNote({ note: id, newDeck: target });
      result.moved++;
    }
    const current = await db.notes.get(id);
    if (!current) continue;
    const outcome = await updateNote(current, n);
    if (outcome === "recreate") {
      await removeNote(current);
      await createNote(id, n, target);
      result.updated++;
    } else if (outcome === "updated") {
      result.updated++;
    }
  }

  const stale = await db.notes
    .where("id")
    .startsWith(`sub-${sub.id}-n-`)
    .toArray();
  for (const note of stale) {
    if (!seen.has(note.id)) {
      await removeNote(note);
      result.deleted++;
    }
  }
  return result;
}

export function describeResult(r: SyncResult) {
  return `${r.created} nuevas · ${r.updated} actualizadas · ${r.moved} movidas · ${r.deleted} borradas`;
}

export async function syncSubscription(sub: Subscription): Promise<SyncResult> {
  try {
    const feed = await fetchFeed(sub);
    const result = await applyFeed(sub, feed);
    patchSubscription(sub.id, {
      lastSync: new Date().toISOString(),
      lastResult: describeResult(result),
      lastError: undefined,
      name: sub.name || feed.name,
    });
    return result;
  } catch (e) {
    patchSubscription(sub.id, {
      lastError: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
