import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SourceSelector } from "./source-selector";
import { SourceSelectionProvider, SOURCE_STORAGE_KEY } from "./source-selection";
import * as api from "@/features/knowledge/api";

// The selector only renders when the backend is online; mock just that hook so
// we exercise the real selection state + persistence without the chat runtime.
vi.mock("./chat-provider", () => ({ useBackend: () => "online" }));

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderSelector() {
  return render(
    <SourceSelectionProvider>
      <SourceSelector />
    </SourceSelectionProvider>,
  );
}

test("renders a checkbox per collection and reflects selection in the label", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([
    { id: 1, name: "Garage", file_count: 2 },
    { id: 2, name: "Manuals", file_count: 1 },
  ]);
  const user = userEvent.setup();
  renderSelector();

  await user.click(await screen.findByRole("button", { name: /sources/i }));
  expect(screen.getByRole("checkbox", { name: /Garage/ })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Manuals/ })).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: /Garage/ }));
  expect(
    screen.getByRole("button", { name: /sources: 1/i }),
  ).toBeInTheDocument();
});

test("persists the choice to localStorage", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([
    { id: 1, name: "Garage", file_count: 2 },
  ]);
  const user = userEvent.setup();
  renderSelector();

  await user.click(await screen.findByRole("button", { name: /sources/i }));
  await user.click(screen.getByRole("checkbox", { name: /Garage/ }));

  expect(JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY)!)).toEqual([1]);
});
