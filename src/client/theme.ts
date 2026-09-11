export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

/**
 * Absent storage means "follow the OS", which is the right default for a
 * dashboard left open all day. Once the toggle is used the choice is explicit
 * and outranks the OS, since a deliberate pick should not be undone at dusk.
 */
export function storedTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The `.dark` class in `styles.css` is what swaps the token palette. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function selectTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
