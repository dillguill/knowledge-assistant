import { Moon, Sun } from "lucide-react";
import { resolveTheme, useSettings } from "./settings-provider";

export function ThemeToggle() {
  const { theme, update } = useSettings();
  const effective = resolveTheme(theme);
  return (
    <button
      aria-label="Toggle light/dark theme"
      title="Toggle theme"
      onClick={() => update("theme", effective === "dark" ? "light" : "dark")}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {effective === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  );
}
