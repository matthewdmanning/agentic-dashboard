import type { PartialUserAppearance, UserAppearance } from "../contract";
import { authorized, failureFrom } from "./request";

/** A user's own appearance preference plus its derived stylesheet (D26, #94). */
export interface AppearanceView extends UserAppearance {
  css: string;
}

/** The caller's own appearance preference and its derived stylesheet (D26, D33-D35, #94). */
export async function loadAppearance(): Promise<AppearanceView> {
  const response = await fetch("/api/appearance", authorized());
  if (!response.ok) {
    throw await failureFrom(response, "Could not load appearance");
  }
  return (await response.json()) as AppearanceView;
}

/** Merges an update onto the caller's stored appearance (D34, #95). Ungated — not a mutation, like `connectIntegration`. */
export async function setAppearance(
  update: PartialUserAppearance,
): Promise<AppearanceView> {
  const response = await fetch(
    "/api/appearance",
    authorized({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    }),
  );
  if (!response.ok) {
    throw await failureFrom(response, "Could not save appearance");
  }
  return (await response.json()) as AppearanceView;
}
