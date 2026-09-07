import type { UserAppearance } from "../contract";
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

/** Replaces the caller's own appearance preference as a whole (D34). Ungated — not a mutation, like `connectIntegration`. */
export async function setAppearance(
  appearance: UserAppearance,
): Promise<AppearanceView> {
  const response = await fetch(
    "/api/appearance",
    authorized({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(appearance),
    }),
  );
  if (!response.ok) {
    throw await failureFrom(response, "Could not save appearance");
  }
  return (await response.json()) as AppearanceView;
}
