import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { SettingsProvider } from "./settings-provider";
import { SettingsPage } from "./settings-page";
import { loadSettings } from "./settings-storage";

beforeEach(() => localStorage.clear());

function renderPage() {
  return render(
    <SettingsProvider>
      <SettingsPage />
    </SettingsProvider>,
  );
}

test("theme choice persists", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("radio", { name: "Dark" }));
  expect(loadSettings().theme).toBe("dark");
});

test("system prompt persists and empties back to null", async () => {
  const user = userEvent.setup();
  renderPage();
  const box = screen.getByLabelText("System prompt");
  await user.type(box, "Cite sources.");
  expect(loadSettings().systemPrompt).toBe("Cite sources.");
  await user.clear(box);
  expect(loadSettings().systemPrompt).toBeNull();
});

test("owner token is a password field with local-only hint", () => {
  renderPage();
  const input = screen.getByLabelText("Owner token");
  expect(input).toHaveAttribute("type", "password");
  expect(screen.getByText(/stored only in this browser/i)).toBeInTheDocument();
});

test("model select is disabled when no models are available", () => {
  renderPage();
  expect(screen.getByLabelText("Default model")).toBeDisabled();
});
