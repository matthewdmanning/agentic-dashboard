import { useId, useState, type FormEvent } from "react";

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  parsePersonalPreset,
  withPersonalPreset,
  type AppearanceView,
} from "./appearance-client";
import {
  settingsMutations,
  type DashboardSettings,
} from "./settings-mutations";

/**
 * One labelled choice over a closed vocabulary — every control in this screen
 * that is not free text. The vocabularies themselves come from `contract`, so
 * a control can only ever offer what the contract already accepts.
 */
function ChoiceField<Value extends string>({
  label,
  value,
  options,
  onChange,
  optionLabel = (option) => option,
}: {
  label: string;
  value: Value;
  options: readonly Value[];
  onChange: (value: Value) => void;
  optionLabel?: (value: Value) => string;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(next) => onChange(next as Value)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** One preset in a list, with the controls that apply to it. */
function PresetRow({
  id,
  selected,
  onSelect,
  onRemove,
}: {
  id: string;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>{id}</FieldTitle>
      </FieldContent>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={selected}
        onClick={onSelect}
      >
        Select
      </Button>
      {onRemove ? (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </Field>
  );
}

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
  const [draftPreset, setDraftPreset] = useState({ id: "", tokenSet: "" });
  const typesetSizeId = useId();
  const connectionNameId = useId();
  const credentialId = useId();
  const presetNameId = useId();
  const presetTokensId = useId();

  /** Every appearance control applies immediately, like `onConnect` — never batched into `onSave`'s mutation list. */
  function updateAppearance(update: PartialUserAppearance) {
    void onSetAppearance(update).catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : "Could not save appearance",
      );
    });
  }

  /**
   * Adds the drafted preset, or replaces the one already holding its name
   * (#96). A preset is a whole token set rather than a handful of fields, so
   * it is pasted rather than assembled from sixty-odd colour inputs; the
   * contract decides whether what arrived is complete.
   */
  function savePersonalPreset() {
    setError(undefined);
    let preset;
    try {
      preset = parsePersonalPreset(draftPreset.id, draftPreset.tokenSet);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not read preset",
      );
      return;
    }
    updateAppearance({
      personalPresets: withPersonalPreset(appearance.personalPresets, preset),
    });
    setDraftPreset({ id: "", tokenSet: "" });
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
    <form
      aria-label="Settings"
      onSubmit={submit}
      className="flex flex-col gap-6"
    >
      <h2 className="text-lg font-medium">Settings</h2>

      {/* A user's own appearance is theirs by structure (D33-D35) — no permission gates this, unlike every fieldset below. */}
      <FieldSet>
        <FieldLegend>Appearance</FieldLegend>
        <FieldGroup>
          <ChoiceField
            label="Base colour"
            value={appearance.baseColour}
            options={baseColours}
            onChange={(baseColour: BaseColour) =>
              updateAppearance({ baseColour })
            }
          />

          <Field>
            <FieldLabel htmlFor={typesetSizeId}>Typeset size</FieldLabel>
            <Input
              id={typesetSizeId}
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
          </Field>

          <ChoiceField
            label="Leading"
            value={appearance.typeset.leading}
            options={typesetLeadings}
            onChange={(leading: TypesetLeading) =>
              updateAppearance({ typeset: { ...appearance.typeset, leading } })
            }
          />

          <ChoiceField
            label="Flow"
            value={appearance.typeset.flow}
            options={typesetFlows}
            onChange={(flow: TypesetFlow) =>
              updateAppearance({ typeset: { ...appearance.typeset, flow } })
            }
          />

          <ChoiceField
            label="Body font"
            value={appearance.typeset.bodyFont}
            options={typesetFontFamilies}
            onChange={(bodyFont: TypesetFontFamily) =>
              updateAppearance({ typeset: { ...appearance.typeset, bodyFont } })
            }
          />

          <ChoiceField
            label="Heading font"
            value={appearance.typeset.headingFont}
            options={typesetFontFamilies}
            onChange={(headingFont: TypesetFontFamily) =>
              updateAppearance({
                typeset: { ...appearance.typeset, headingFont },
              })
            }
          />

          <ChoiceField
            label="Monospace font"
            value={appearance.typeset.monospaceFont}
            options={typesetFontFamilies}
            onChange={(monospaceFont: TypesetFontFamily) =>
              updateAppearance({
                typeset: { ...appearance.typeset, monospaceFont },
              })
            }
          />

          <ChoiceField
            label="Menu colour"
            value={appearance.menuColour}
            options={menuColours}
            onChange={(menuColour: MenuColour) =>
              updateAppearance({ menuColour })
            }
          />

          <ChoiceField
            label="Menu accent"
            value={appearance.menuAccent}
            options={menuAccents}
            onChange={(menuAccent: MenuAccent) =>
              updateAppearance({ menuAccent })
            }
          />

          {/*
            A preset overrides base colour entirely once selected (D26, D27,
            #96). Server presets are added by `presentation: write` through
            the mutation pipeline above, not from here — this panel only
            selects, removes, and clears, the ungated user-owned operations.
          */}
          {dashboard.presets && dashboard.presets.length > 0 ? (
            <FieldGroup>
              <h3 className="text-sm font-medium">Server presets</h3>
              {dashboard.presets.map((preset) => (
                <PresetRow
                  key={preset.id}
                  id={preset.id}
                  selected={
                    appearance.selectedPreset?.source === "server" &&
                    appearance.selectedPreset.id === preset.id
                  }
                  onSelect={() =>
                    updateAppearance({
                      selectedPreset: { source: "server", id: preset.id },
                    })
                  }
                />
              ))}
            </FieldGroup>
          ) : null}

          {appearance.personalPresets.length > 0 ? (
            <FieldGroup>
              <h3 className="text-sm font-medium">Your presets</h3>
              {appearance.personalPresets.map((preset) => (
                <PresetRow
                  key={preset.id}
                  id={preset.id}
                  selected={
                    appearance.selectedPreset?.source === "personal" &&
                    appearance.selectedPreset.id === preset.id
                  }
                  onSelect={() =>
                    updateAppearance({
                      selectedPreset: { source: "personal", id: preset.id },
                    })
                  }
                  onRemove={() =>
                    updateAppearance({
                      personalPresets: appearance.personalPresets.filter(
                        ({ id }) => id !== preset.id,
                      ),
                    })
                  }
                />
              ))}
            </FieldGroup>
          ) : null}

          {appearance.selectedPreset ? (
            <Field orientation="horizontal">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateAppearance({ selectedPreset: null })}
              >
                Clear preset selection
              </Button>
            </Field>
          ) : null}

          {/* Adding a preset is the user's own, ungated like every other control here (D35). Reusing a name replaces that preset. */}
          <FieldGroup>
            <h3 className="text-sm font-medium">Add a preset</h3>
            <Field>
              <FieldLabel htmlFor={presetNameId}>Preset name</FieldLabel>
              <Input
                id={presetNameId}
                value={draftPreset.id}
                onChange={(event) =>
                  setDraftPreset({
                    ...draftPreset,
                    id: event.currentTarget.value,
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={presetTokensId}>Token set</FieldLabel>
              <Textarea
                id={presetTokensId}
                rows={6}
                value={draftPreset.tokenSet}
                onChange={(event) =>
                  setDraftPreset({
                    ...draftPreset,
                    tokenSet: event.currentTarget.value,
                  })
                }
              />
              <FieldDescription>
                A complete token set: a light and a dark block naming every
                token, a radius, the theme mapping, and the base rules.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  draftPreset.id === "" || draftPreset.tokenSet.trim() === ""
                }
                onClick={savePersonalPreset}
              >
                Save preset
              </Button>
            </Field>
          </FieldGroup>
        </FieldGroup>
      </FieldSet>

      {settings.dashboard && settings.themes ? (
        <FieldSet>
          <FieldLegend>Theme</FieldLegend>
          <FieldGroup>
            <ChoiceField
              label="Selected theme"
              value={settings.dashboard.theme}
              options={settings.themes.map(({ id }) => id)}
              onChange={(theme) =>
                setSettings({
                  ...settings,
                  dashboard: settings.dashboard && {
                    ...settings.dashboard,
                    theme,
                  },
                })
              }
            />
            {selectedTheme ? (
              <ChoiceField
                label="Density"
                value={String(selectedTheme.settings.density ?? "")}
                options={["", "comfortable", "compact"]}
                optionLabel={(density) =>
                  density === "" ? "Default" : density
                }
                onChange={(density) =>
                  updateTheme(selectedTheme.id, (theme) => ({
                    ...theme,
                    settings: { ...theme.settings, density },
                  }))
                }
              />
            ) : null}
            {settings.themes.map((theme) => (
              <Field key={theme.id} orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{theme.id}</FieldTitle>
                </FieldContent>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
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
                </Button>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>
      ) : null}

      {/*
        Connecting an integration authorizes this dashboard to use an external
        service. It does not configure what a card shows — that is a card's
        query. So this panel names the connection and never its fields, and
        knows no integration type of its own.
      */}
      {settings.integrations ? (
        <FieldSet>
          <FieldLegend>Integrations</FieldLegend>
          <FieldGroup>
            {blockedIntegrationNotices.length > 0 ? (
              <Alert>
                <AlertTitle>Blocked by an administrator</AlertTitle>
                <AlertDescription>
                  {blockedIntegrationNotices.join(", ")}. Your connection and
                  data remain stored; reconnecting is not needed once it is
                  unblocked.
                </AlertDescription>
              </Alert>
            ) : null}
            {unavailableQueryNotices.length > 0 ? (
              <Alert>
                <AlertTitle>
                  Some of your saved queries reference an integration that no
                  longer exists
                </AlertTitle>
                <AlertDescription>
                  {unavailableQueryNotices.join(", ")}. They remain stored but
                  will not refresh.
                </AlertDescription>
              </Alert>
            ) : null}
            {settings.integrations.map((integration) => (
              <Field key={integration.id} orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{integration.id}</FieldTitle>
                  <FieldDescription>{integration.type}</FieldDescription>
                </FieldContent>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
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
                </Button>
              </Field>
            ))}
            <Field>
              <FieldLabel htmlFor={connectionNameId}>Name</FieldLabel>
              <Input
                id={connectionNameId}
                value={connection.id}
                onChange={(event) =>
                  setConnection({
                    ...connection,
                    id: event.currentTarget.value,
                  })
                }
              />
            </Field>
            <ChoiceField
              label="Service"
              value={connection.type}
              options={connectableTypes}
              onChange={(type) => setConnection({ ...connection, type })}
            />
            <Field>
              <FieldLabel htmlFor={credentialId}>Credential</FieldLabel>
              <Input
                id={credentialId}
                type="password"
                value={connection.credential}
                onChange={(event) =>
                  setConnection({
                    ...connection,
                    credential: event.currentTarget.value,
                  })
                }
              />
            </Field>
            <Field orientation="horizontal">
              <Button
                type="button"
                variant="outline"
                disabled={connection.id === "" || connection.type === ""}
                onClick={connect}
              >
                Connect
              </Button>
            </Field>
          </FieldGroup>
        </FieldSet>
      ) : null}

      {callerRole ? (
        <FieldSet>
          <FieldLegend>Your role</FieldLegend>
          <FieldGroup>
            <FieldTitle>{callerRole.name}</FieldTitle>
            {Object.entries(callerRole.permissions).map(([category, level]) => (
              <FieldDescription key={category}>
                {category}: {level}
              </FieldDescription>
            ))}
          </FieldGroup>
        </FieldSet>
      ) : null}

      {dashboard.roles ? (
        <FieldSet>
          <FieldLegend>Roles</FieldLegend>
          <FieldGroup>
            {dashboard.roles.map((role) => (
              <FieldContent key={role.name}>
                <FieldTitle>{role.name}</FieldTitle>
                {Object.entries(role.permissions).map(([category, level]) => (
                  <FieldDescription key={category}>
                    {category}: {level}
                  </FieldDescription>
                ))}
              </FieldContent>
            ))}
          </FieldGroup>
        </FieldSet>
      ) : null}

      {error ? (
        <Alert>
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}
      <Field orientation="horizontal">
        <Button type="submit">Save settings</Button>
      </Field>
    </form>
  );
}
