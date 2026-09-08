import type { Mutation, ReadableDashboard } from "../contract";

/** The categories Settings edits, each absent when the caller may not read it. */
export type DashboardSettings = Pick<
  ReadableDashboard,
  "dashboard" | "integrations" | "themes"
>;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function presentationMutations(
  initial: DashboardSettings,
  settings: DashboardSettings,
): Mutation[] {
  const mutations: Mutation[] = [];

  if (
    settings.dashboard &&
    initial.dashboard &&
    !sameValue(initial.dashboard, settings.dashboard)
  ) {
    mutations.push({ type: "edit-dashboard", dashboard: settings.dashboard });
  }
  if (settings.themes && initial.themes) {
    const before = new Map(initial.themes.map((theme) => [theme.id, theme]));
    const after = new Set(settings.themes.map(({ id }) => id));

    for (const theme of settings.themes) {
      const previous = before.get(theme.id);
      if (!previous) {
        mutations.push({ type: "add-theme", theme });
      } else if (!sameValue(previous, theme)) {
        mutations.push({ type: "edit-theme", theme });
      }
    }
    for (const { id } of initial.themes) {
      if (!after.has(id)) {
        mutations.push({ type: "remove-theme", themeId: id });
      }
    }
  }

  return mutations;
}

function integrationMutations(
  initial: DashboardSettings,
  settings: DashboardSettings,
): Mutation[] {
  if (!settings.integrations || !initial.integrations) return [];

  const mutations: Mutation[] = [];
  const before = new Map(
    initial.integrations.map((integration) => [integration.id, integration]),
  );
  const after = new Set(settings.integrations.map(({ id }) => id));

  for (const integration of settings.integrations) {
    if (!before.has(integration.id)) {
      mutations.push({ type: "add-integration", integration });
    }
  }
  for (const { id } of initial.integrations) {
    if (!after.has(id)) {
      mutations.push({ type: "remove-integration", integrationId: id });
    }
  }

  return mutations;
}

/**
 * The mutations that turn saved settings into the edited draft. A category the
 * caller could not read is absent from both, and produces nothing — Settings
 * never invents a change to something it was not shown.
 */
export function settingsMutations(
  saved: DashboardSettings,
  draft: DashboardSettings,
): Mutation[] {
  return [
    ...presentationMutations(saved, draft),
    ...integrationMutations(saved, draft),
  ];
}
