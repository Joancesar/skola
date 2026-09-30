import { Subscription } from "./types";

/**
 * Las suscripciones (URL y token) se guardan solo en este dispositivo, en
 * localStorage, para que el token no viaje con la sincronización en la nube.
 */
const KEY = "skola.subscriptions.v1";
const EVENT = "skola-subscriptions-changed";

export function getSubscriptions(): Subscription[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Subscription[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveSubscriptions(list: Subscription[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* almacenamiento no disponible: se pierde la configuración, no los datos */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function upsertSubscription(sub: Subscription) {
  const list = getSubscriptions().filter((s) => s.id !== sub.id);
  saveSubscriptions([...list, sub]);
}

export function patchSubscription(id: string, patch: Partial<Subscription>) {
  saveSubscriptions(
    getSubscriptions().map((s) => (s.id === id ? { ...s, ...patch } : s))
  );
}

export function removeSubscription(id: string) {
  saveSubscriptions(getSubscriptions().filter((s) => s.id !== id));
}

export function onSubscriptionsChanged(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Quita tildes y diacríticos (marcas combinantes U+0300–U+036F). */
function stripAccents(text: string) {
  return text
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x300 || code > 0x36f;
    })
    .join("");
}

/** Convierte un nombre en un id válido para prefijar mazos y notas. */
export function slugify(text: string) {
  return (
    stripAccents(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "feed"
  );
}
