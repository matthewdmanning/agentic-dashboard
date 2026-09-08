import { useEffect, useState } from "react";

import {
  defaultUserAppearance,
  type Mutation,
  type PartialUserAppearance,
  type ReadableDashboard,
  type Role,
} from "../contract";
import {
  loadAppearance,
  setAppearance,
  type AppearanceView,
} from "./appearance-client";
import {
  applyDashboardMutations,
  loadCallerRole,
  loadReadableDashboard,
} from "./dashboard-configuration-client";
import {
  connectIntegration,
  loadBlockedIntegrationNotices,
  loadConnectableIntegrationTypes,
  loadUnavailableQueryNotices,
  refreshIntegrations,
} from "./integrations-client";
import { CardView } from "./cards/CardView";
import {
  enqueue,
  pendingMutationCount,
  readCachedDashboard,
  replayQueue,
  requiresLiveService,
  writeCachedDashboard,
} from "./offline";
import { RequestFailure } from "./request";
import { Settings } from "./Settings";

function renderDashboard({ dashboard, cards }: ReadableDashboard) {
  if (!dashboard || !cards) {
    return <p>You do not have permission to view this dashboard.</p>;
  }

  const byId = new Map(cards.map((card) => [card.id, card]));

  // Typeset (size, leading, flow, fonts) comes from the viewing user's own
  // appearance — applied globally by the injected `<style id="appearance-tokens">`
  // block's `main` rule (D33-D35, #95), never an inline style here.
  return (
    <main data-theme={dashboard.theme}>
      {dashboard.cards.map((cardId) => {
        const card = byId.get(cardId);
        if (!card) return null;
        return (
          <section key={card.id}>
            <h2>{card.title}</h2>
            <CardView template={card.template} state={card.state} />
          </section>
        );
      })}
    </main>
  );
}

export function App() {
  const [dashboard, setDashboard] = useState<ReadableDashboard>();
  const [callerRole, setCallerRole] = useState<Role>();
  const [error, setError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [offline, setOffline] = useState(false);
  const [connectableTypes, setConnectableTypes] = useState<string[]>([]);
  const [blockedIntegrationNotices, setBlockedIntegrationNotices] = useState<
    string[]
  >([]);
  const [unavailableQueryNotices, setUnavailableQueryNotices] = useState<
    string[]
  >([]);
  const [appearance, setAppearanceState] = useState<AppearanceView>({
    ...defaultUserAppearance,
    css: "",
  });
  const [pendingCount, setPendingCount] = useState(
    pendingMutationCount(localStorage),
  );

  async function sync(): Promise<void> {
    const { dropped } = await replayQueue(
      localStorage,
      applyDashboardMutations,
    );
    setPendingCount(pendingMutationCount(localStorage));
    if (dropped.length > 0) {
      setRefreshError(dropped.map((failure) => failure.message).join(", "));
    }
  }

  /**
   * Both persistent integration notices (D40, #92, #93). Re-read after every
   * mutation as well as on mount: blocking, unblocking, and removing an entry
   * are all mutations, so a notice that only loaded once was stale the moment
   * an administrator changed one — including in the tab that changed it.
   * Neither notice is worth surfacing a failure over; a stale notice is
   * better than an error banner over a working dashboard.
   */
  function loadIntegrationNotices(): void {
    void loadBlockedIntegrationNotices()
      .then(setBlockedIntegrationNotices)
      .catch(() => undefined);
    void loadUnavailableQueryNotices()
      .then(setUnavailableQueryNotices)
      .catch(() => undefined);
  }

  useEffect(() => {
    void loadReadableDashboard()
      .then((loaded) => {
        setDashboard(loaded);
        setOffline(false);
        writeCachedDashboard(localStorage, loaded);
        return sync();
      })
      .catch((reason: unknown) => {
        if (reason instanceof RequestFailure) {
          setError(reason.message);
          return;
        }
        const cached = readCachedDashboard(localStorage);
        if (!cached) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load dashboard",
          );
          return;
        }
        setDashboard(cached);
        setOffline(true);
      });
    void loadCallerRole().then(setCallerRole);
    void loadConnectableIntegrationTypes()
      .then(setConnectableTypes)
      .catch(() => undefined);
    loadIntegrationNotices();
    void loadAppearance()
      .then(setAppearanceState)
      .catch(() => undefined);

    const handleOnline = () => void sync().then(() => setOffline(false));
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  async function saveMutations(mutations: readonly Mutation[]): Promise<void> {
    try {
      const result = await applyDashboardMutations(mutations);
      setDashboard(result);
      writeCachedDashboard(localStorage, result);
      setOffline(false);
      loadIntegrationNotices();
    } catch (reason) {
      // `integrations` mutations require a live service (D15) and are never
      // queued — the caller sees this failure directly.
      if (reason instanceof RequestFailure || requiresLiveService(mutations)) {
        throw reason;
      }
      enqueue(localStorage, mutations);
      setPendingCount(pendingMutationCount(localStorage));
      setOffline(true);
    }
  }

  async function saveAppearance(update: PartialUserAppearance): Promise<void> {
    setAppearanceState(await setAppearance(update));
  }

  if (error) return <p role="alert">{error}</p>;
  if (!dashboard) return <p>Loading dashboard…</p>;

  return (
    <>
      {/* Server-generated from a closed base-colour vocabulary (D26) — never arbitrary CSS. */}
      <style id="appearance-tokens">{appearance.css}</style>
      {offline ? (
        <p role="status">
          Offline — {pendingCount} change{pendingCount === 1 ? "" : "s"} pending
        </p>
      ) : null}
      {renderDashboard(dashboard)}
      <section aria-label="Integrations">
        <button
          type="button"
          onClick={() => {
            setRefreshError(undefined);
            void refreshIntegrations()
              .then((refreshes) => {
                const failed = refreshes.filter(
                  ({ status }) => status === "failed",
                );
                if (failed.length > 0) {
                  setRefreshError(
                    failed
                      .map(
                        ({ cardId, message }) =>
                          `${cardId}: ${message ?? "failed"}`,
                      )
                      .join(", "),
                  );
                }
              })
              .catch((reason: unknown) =>
                setRefreshError(
                  reason instanceof Error ? reason.message : "Refresh failed",
                ),
              );
          }}
        >
          Refresh
        </button>
        {refreshError ? <p role="alert">{refreshError}</p> : null}
      </section>
      <details>
        <summary>Settings</summary>
        <Settings
          dashboard={dashboard}
          callerRole={callerRole}
          connectableTypes={connectableTypes}
          blockedIntegrationNotices={blockedIntegrationNotices}
          unavailableQueryNotices={unavailableQueryNotices}
          appearance={appearance}
          onSave={saveMutations}
          onConnect={connectIntegration}
          onSetAppearance={saveAppearance}
        />
      </details>
    </>
  );
}
