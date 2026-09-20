import { useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { selectTheme, storedTheme, type Theme } from "./theme";

/**
 * Part of the page shell rather than a tile: every dashboard has one, and it
 * is not something an agent places or removes.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      data-theme-toggle
      onClick={() => {
        selectTheme(next);
        setTheme(next);
      }}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
