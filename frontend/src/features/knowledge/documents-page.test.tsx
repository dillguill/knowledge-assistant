import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { DocumentsPage } from "./documents-page";
import * as api from "./api";

beforeEach(() => vi.restoreAllMocks());

test("lists collections with counts and shows sync status", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([
    { id: 1, name: "Demo corpus", file_count: 2 },
  ]);
  vi.spyOn(api, "syncStatus").mockResolvedValue("idle");
  render(<DocumentsPage />);
  expect(await screen.findByText("Demo corpus")).toBeInTheDocument();
  expect(screen.getByText(/2 files/)).toBeInTheDocument();
  expect(await screen.findByText(/sync: idle/i)).toBeInTheDocument();
});

test("selecting a collection lists its files with raw links", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([
    { id: 1, name: "Garage", file_count: 1 },
  ]);
  vi.spyOn(api, "syncStatus").mockResolvedValue("idle");
  vi.spyOn(api, "listFiles").mockResolvedValue([
    { id: 7, filename: "manual.pdf", content_type: "application/pdf", size_bytes: 8_200_000 },
  ]);
  const user = userEvent.setup();
  render(<DocumentsPage />);
  await user.click(await screen.findByText("Garage"));
  const link = await screen.findByRole("link", { name: /manual\.pdf/ });
  expect(link).toHaveAttribute("href", api.rawFileUrl(7));
});

test("upload failure surfaces the owner-token hint", async () => {
  vi.spyOn(api, "listCollections").mockResolvedValue([
    { id: 1, name: "Garage", file_count: 0 },
  ]);
  vi.spyOn(api, "syncStatus").mockResolvedValue("idle");
  vi.spyOn(api, "listFiles").mockResolvedValue([]);
  vi.spyOn(api, "uploadFile").mockRejectedValue(
    new Error("Owner token required — set it in Settings."),
  );
  const user = userEvent.setup();
  render(<DocumentsPage />);
  await user.click(await screen.findByText("Garage"));
  const input = screen.getByLabelText(/upload file/i);
  await user.upload(input, new File(["x"], "a.md", { type: "text/markdown" }));
  expect(
    await screen.findByText(/owner token required/i),
  ).toBeInTheDocument();
});
