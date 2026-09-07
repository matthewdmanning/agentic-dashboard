import { useState, type FormEvent } from "react";

import {
  baseColours,
  menuAccents,
  menuColours,
  typesetFlows,
  typesetFontFamilies,
  typesetLeadings,
  type BaseColour,
  type MenuAccent,
  type MenuColour,
  type Mutation,
  type PartialUserAppearance,
  type ReadableDashboard,
  type Role,
  type Theme,
  type TypesetFlow,
  type TypesetFontFamily,
  type TypesetLeading,
} from "../contract";
import type { AppearanceView } from "./appearance-client";
import {
  settingsMutations,
  type DashboardSettings,
} from "./settings-mutations";

export function Settings({
  dashboard,
  callerRole,
  connectableTypes,
  blockedIntegrationNotices,
  unavailableQueryNotices,
  appearance,
  onSave,
  onConnect,
  onSetAppearance,
}: {
  dashboard: ReadableDashboard;
  /** The caller's own role, so a user can see what this session may do. */
  callerRole?: Role;
  /** The services this build can connect to (#66) — Settings names none of its own. */
  connectableTypes: string[];
  /** Blocked catalog entries the caller holds a connection to (D40, #92) — persists until the entry is unblocked or removed. */
  blockedIntegrationNotices: string[];
  /** Integrations the caller's own queries name that no longer exist (D40, #93) — a force-removed dependent integration never cascade-deletes a query. */
  unavailableQueryNotices: string[];
  /** The caller's own appearance preference (D26, D33-D35, #94) — theirs by structure, ungated. */
  appearance: AppearanceView;
  onSave: (mutations: readonly Mutation[]) => Promise<void>;
  /** Hands a connection's secret to the server. Not a mutation — see `contract`'s ban on a credential-shaped settings key. */
  onConnect: (integrationId: string, credential: string) => Promise<void>;
  /** Merges an update onto the caller's own stored appearance (D34, #95). Not a mutation — applies immediately, like `onConnect`. */
  onSetAppearance: (update: PartialUserAppearance) => Promise<void>;
}) {
  const initial: DashboardSettings = {
    dashboard: dashboard.dashboard,
    integrations: dashboard.integrations,
    themes: dashboard.themes,
  };
  const [settings, setSettings] = useState<DashboardSettings>(initial);
  const [connection, setConnection] = useState({
    id: "",
    type: "",
    credential: "",
  });
  const [error, setError] = useState<string>();

  /** Every appearance control applies immediately, like `onConnect` — never batched into `onSave`'s mutation list. */
  function updateAppearance(update: PartialUserAppearance) {
    void onSetAppearance(update).catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : "Could not save appearance",
      );
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const mutations = settingsMutations(initial, settings);
    if (mutations.length === 0) return;

    setError(undefined);
    void onSave(mutations).catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : "Could not save settings",
      );
    });
  }

  function connect() {
    setError(undefined);
    void (
      connection.credential === ""
        ? Promise.resolve()
        : onConnect(connection.id, connection.credential)
    )
      .then(() => {
        setSettings({
          ...settings,
          integrations: [
            ...(settings.integrations ?? []),
            { id: connection.id, type: connection.type, settings: {} },
          ],
        });
        setConnection({ id: "", type: "", credential: "" });
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : "Could not connect",
        );
      });
  }

  function updateTheme(id: string, update: (theme: Theme) => Theme) {
    setSettings({
      ...settings,
      themes: settings.themes?.map((theme) =>
        theme.id === id ? update(theme) : theme,
      ),
    });
  }

  const selectedTheme = settings.themes?.find(
    ({ id }) => id === settings.dashboard?.theme,
  );

  return (
    <form aria-label="Settings" onSubmit={submit}>
      <h2>Settings</h2>

      {/* A user's own appearance is theirs by structure (D33-D35) — no permission gates this, unlike every fieldset below. */}
      <fieldset>
        <legend>Appearance</legend>
        <label>
          Base colour
          <select
            value={appearance.baseColour}
            onChange={(event) =>
              updateAppearance({
                baseColour: event.currentTarget.value as BaseColour,
              })
            }
          >
            {baseColours.map((colour) => (
              <option key={colour} value={colour}>
                {colour}
              </option>
            ))}
          </select>
        </label>

        <label>
          Typeset size
          <input
            type="range"
            min="0.75"
            max="2"
            step="0.05"
            value={appearance.typeset.size}
            onChange={(event) =>
              updateAppearance({
                typeset: {
                  ...appearance.typeset,
                  size: event.currentTarget.valueAsNumber,
                },
              })
            }
          />
        </label>

        <label>
          Leading
          <select
            value={appearance.typeset.leading}
            onChange={(event) =>
              updateAppearance({
                typeset: {
                  ...appearance.typeset,
                  leading: event.currentTarget.value as TypesetLeading,
                },
              })
            }
          >
            {typesetLeadings.map((leading) => (
              <option key={leading} value={leading}>
                {leading}
              </option>
            ))}
          </select>
        </label>

        <label>
          Flow
          <select
            value={appearance.typeset.flow}
            onChange={(event) =>
              updateAppearance({
                typeset: {
                  ...appearance.typeset,
                  flow: event.currentTarget.value as TypesetFlow,
                },
              })
            }
          >
            {typesetFlows.map((flow) => (
              <option key={flow} value={flow}>
                {flow}
              </option>
            ))}
          </select>
        </label>

        <label>
          Body font
          <select
            value={appearance.typeset.bodyFont}
            onChange={(event) =>
              updateAppearance({
                typeset: {
                  ...appearance.typeset,
                  bodyFont: event.currentTarget.value as TypesetFontFamily,
                },
              })
            }
          >
            {typesetFontFamilies.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>

        <label>
          Heading font
          <select
            value={appearance.typeset.headingFont}
            onChange={(event) =>
              updateAppearance({
                typeset: {
                  ...appearance.typeset,
                  headingFont: event.currentTarget.value as TypesetFontFamily,
                },
              })
            }
          >
            {typesetFontFamilies.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>

        <label>
          Monospace font
          <select
            value={appearance.typeset.monospaceFont}
            onChange={(event) =>
              updateAppearance({
                typeset: {
                  ...appearance.typeset,
                  monospaceFont: event.currentTarget.value as TypesetFontFamily,
                },
              })
            }
          >
            {typesetFontFamilies.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>

        <label>
          Menu colour
          <select
            value={appearance.menuColour}
            onChange={(event) =>
              updateAppearance({
                menuColour: event.currentTarget.value as MenuColour,
              })
            }
          >
            {menuColours.map((menuColour) => (
              <option key={menuColour} value={menuColour}>
                {menuColour}
              </option>
            ))}
          </select>
        </label>

        <label>
          Menu accent
          <select
            value={appearance.menuAccent}
            onChange={(event) =>
              updateAppearance({
                menuAccent: event.currentTarget.value as MenuAccent,
              })
            }
          >
            {menuAccents.map((menuAccent) => (
              <option key={menuAccent} value={menuAccent}>
                {menuAccent}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {settings.dashboard && settings.themes ? (
        <fieldset>
          <legend>Theme</legend>
          <label>
            Selected theme
            <select
              value={settings.dashboard.theme}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  dashboard: settings.dashboard && {
                    ...settings.dashboard,
                    theme: event.currentTarget.value,
                  },
                })
              }
            >
              {settings.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.id}
                </option>
              ))}
            </select>
          </label>
          {selectedTheme ? (
            <label>
              Density
              <select
                value={String(selectedTheme.settings.density ?? "")}
                onChange={(event) =>
                  updateTheme(selectedTheme.id, (theme) => ({
                    ...theme,
                    settings: {
                      ...theme.settings,
                      density: event.currentTarget.value,
                    },
                  }))
                }
              >
                <option value="">Default</option>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          ) : null}
          {settings.themes.map((theme) => (
            <div key={theme.id}>
              <span>{theme.id}</span>
              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    themes: settings.themes?.filter(
                      ({ id }) => id !== theme.id,
                    ),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </fieldset>
      ) : null}

      {/*
        Connecting an integration authorizes this dashboard to use an external
        service. It does not configure what a card shows — that is a card's
        query. So this panel names the connection and never its fields, and
        knows no integration type of its own.
      */}
      {settings.integrations ? (
        <fieldset>
          <legend>Integrations</legend>
          {blockedIntegrationNotices.length > 0 ? (
            <p role="alert">
              Blocked by an administrator:{" "}
              {blockedIntegrationNotices.join(", ")}. Your connection and data
              remain stored; reconnecting is not needed once it is unblocked.
            </p>
          ) : null}
          {unavailableQueryNotices.length > 0 ? (
            <p role="alert">
              Some of your saved queries reference an integration that no longer
              exists: {unavailableQueryNotices.join(", ")}. They remain stored
              but will not refresh.
            </p>
          ) : null}
          {settings.integrations.map((integration) => (
            <div key={integration.id}>
              <span>{integration.id}</span>
              <span>{integration.type}</span>
              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    integrations: settings.integrations?.filter(
                      ({ id }) => id !== integration.id,
                    ),
                  })
                }
              >
                Disconnect
              </button>
            </div>
          ))}
          <label>
            Name
            <input
              value={connection.id}
              onChange={(event) =>
                setConnection({ ...connection, id: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Service
            <select
              value={connection.type}
              onChange={(event) =>
                setConnection({
                  ...connection,
                  type: event.currentTarget.value,
                })
              }
            >
              <option value="">Select a service</option>
              {connectableTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Credential
            <input
              type="password"
              value={connection.credential}
              onChange={(event) =>
                setConnection({
                  ...connection,
                  credential: event.currentTarget.value,
                })
              }
            />
          </label>
          <button
            type="button"
            disabled={connection.id === "" || connection.type === ""}
            onClick={connect}
          >
            Connect
          </button>
        </fieldset>
      ) : null}

      {callerRole ? (
        <fieldset>
          <legend>Your role</legend>
          <h3>{callerRole.name}</h3>
          {Object.entries(callerRole.permissions).map(([category, level]) => (
            <p key={category}>
              {category}: {level}
            </p>
          ))}
        </fieldset>
      ) : null}

      {dashboard.roles ? (
        <fieldset>
          <legend>Roles</legend>
          {dashboard.roles.map((role) => (
            <div key={role.name}>
              <h3>{role.name}</h3>
              {Object.entries(role.permissions).map(([category, level]) => (
                <p key={category}>
                  {category}: {level}
                </p>
              ))}
            </div>
          ))}
        </fieldset>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      <button type="submit">Save settings</button>
    </form>
  );
}
