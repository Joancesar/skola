import { Button } from "@/components/ui/Button";
import { Group } from "@/components/ui/Group";
import { Stack } from "@/components/ui/Stack";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { TextInput } from "@/components/ui/TextInput";
import {
  getSubscriptions,
  onSubscriptionsChanged,
  patchSubscription,
  removeSubscription,
  slugify,
  upsertSubscription,
} from "@/logic/subscription/storage";
import { describeResult, syncSubscription } from "@/logic/subscription/sync";
import { Subscription } from "@/logic/subscription/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Section from "./Section";

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function SubscriptionItem({ sub }: { sub: Subscription }) {
  const [t] = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await syncSubscription(sub);
      setMessage(describeResult(r));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={sub.name || sub.id}
      rightSection={
        <Group gap="xs">
          <Button size="sm" variant="primary" onClick={sync} disabled={busy}>
            {busy
              ? t("settings.subscriptions.syncing", "Sincronizando…")
              : t("settings.subscriptions.sync-now", "Sincronizar ahora")}
          </Button>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => removeSubscription(sub.id)}
            disabled={busy}
          >
            {t("settings.subscriptions.remove", "Quitar")}
          </Button>
        </Group>
      }
    >
      <Stack gap="xs">
        <Text size="sm" variant="dimmed">
          {sub.url}
        </Text>
        <Text size="sm">
          {t("settings.subscriptions.last-sync", "Última sincronización")}:{" "}
          {formatDate(sub.lastSync)}
          {sub.lastResult ? ` · ${sub.lastResult}` : ""}
        </Text>
        {sub.lastError && (
          <Text size="sm" style={{ color: "var(--theme-red, #c0392b)" }}>
            {t("settings.subscriptions.last-error", "Último error")}:{" "}
            {sub.lastError}
          </Text>
        )}
        {message && <Text size="sm">{message}</Text>}
        <Switch
          label={t(
            "settings.subscriptions.auto-sync",
            "Sincronizar al abrir la app (como mucho cada 6 h)"
          )}
          checked={sub.autoSync}
          onChange={(e) =>
            patchSubscription(sub.id, { autoSync: e.currentTarget.checked })
          }
        />
        <Text size="xs" variant="dimmed">
          {t(
            "settings.subscriptions.remove-hint",
            "Quitar la suscripción no borra sus tarjetas; si se vuelve a añadir con el mismo identificador, se retoman."
          )}
        </Text>
      </Stack>
    </Section>
  );
}

export default function SubscriptionsSettingsView() {
  const [t] = useTranslation();
  const [subs, setSubs] = useState<Subscription[]>(getSubscriptions());
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => onSubscriptionsChanged(() => setSubs(getSubscriptions())),
    []
  );

  const add = () => {
    setError(null);
    try {
      const parsed = new URL(url.trim());
      const subId = slugify(
        id.trim() ||
          parsed.pathname.split("/").filter(Boolean).pop() ||
          parsed.hostname
      );
      if (subs.some((s) => s.id === subId)) {
        setError(
          t(
            "settings.subscriptions.duplicate",
            "Ya hay una suscripción con ese identificador"
          )
        );
        return;
      }
      upsertSubscription({
        id: subId,
        url: parsed.toString(),
        token: token.trim() || undefined,
        autoSync: true,
      });
      setUrl("");
      setToken("");
      setId("");
    } catch {
      setError(t("settings.subscriptions.invalid-url", "La URL no es válida"));
    }
  };

  return (
    <Stack gap="xl" align="stretch">
      <Text size="sm" variant="dimmed">
        {t(
          "settings.subscriptions.description",
          "Un mazo suscrito se descarga de una URL y se mantiene al día: entran las tarjetas nuevas, se actualizan las cambiadas sin perder tu progreso y se quitan las que desaparecen del mazo. La URL y el token se guardan solo en este dispositivo."
        )}
      </Text>
      {subs.map((s) => (
        <SubscriptionItem key={s.id} sub={s} />
      ))}
      <Section title={t("settings.subscriptions.add", "Añadir suscripción")}>
        <Stack gap="sm">
          <TextInput
            label={t("settings.subscriptions.url", "URL del mazo")}
            placeholder="https://…/api/feeds/remesas"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <TextInput
            label={t("settings.subscriptions.token", "Token de lectura")}
            type="password"
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
          />
          <TextInput
            label={t("settings.subscriptions.id", "Identificador (opcional)")}
            description={t(
              "settings.subscriptions.id-description",
              "Prefija los mazos y notas de esta suscripción. Si lo dejas vacío, se saca de la URL."
            )}
            value={id}
            onChange={(e) => setId(e.currentTarget.value)}
          />
          {error && (
            <Text size="sm" style={{ color: "var(--theme-red, #c0392b)" }}>
              {error}
            </Text>
          )}
          <Group>
            <Button variant="primary" onClick={add} disabled={!url.trim()}>
              {t("settings.subscriptions.add-button", "Añadir")}
            </Button>
          </Group>
        </Stack>
      </Section>
    </Stack>
  );
}
