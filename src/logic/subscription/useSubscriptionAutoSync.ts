import { useEffect } from "react";
import { getSubscriptions } from "./storage";
import { syncSubscription } from "./sync";

/** Cada cuánto se vuelve a mirar el feed al abrir o volver a la app. */
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
let running = false;

async function syncDue() {
  if (running || !navigator.onLine) return;
  running = true;
  try {
    for (const sub of getSubscriptions()) {
      if (!sub.autoSync) continue;
      const last = sub.lastSync ? Date.parse(sub.lastSync) : 0;
      if (Date.now() - last < MIN_INTERVAL_MS) continue;
      try {
        await syncSubscription(sub);
      } catch (e) {
        console.warn(`[skola] no se pudo sincronizar ${sub.id}`, e);
      }
    }
  } finally {
    running = false;
  }
}

export function useSubscriptionAutoSync() {
  useEffect(() => {
    void syncDue();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncDue();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);
}
