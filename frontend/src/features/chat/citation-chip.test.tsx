import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CitationChip } from "./citation-chip";
import * as wikiNav from "@/app/wiki-navigation";

test("a document source opens the raw file in a new tab", () => {
  render(
    <CitationChip
      url="https://api.test/api/knowledge/files/3/raw"
      title="[S1] manual.pdf"
      kind="document"
    />,
  );
  const link = screen.getByRole("link", { name: "[S1] manual.pdf" });
  expect(link).toHaveAttribute("href", "https://api.test/api/knowledge/files/3/raw");
  expect(link).toHaveAttribute("target", "_blank");
});

test("a source with no kind (pre-wiki shape) still opens the raw file, unaffected", () => {
  render(<CitationChip url="https://api.test/api/knowledge/files/3/raw" title="[S1] manual.pdf" />);
  const link = screen.getByRole("link", { name: "[S1] manual.pdf" });
  expect(link).toHaveAttribute("target", "_blank");
});

test("a wiki source links internally to the page and does not open a new tab", async () => {
  const spy = vi.spyOn(wikiNav, "requestWikiPage").mockImplementation(() => {});
  const user = userEvent.setup();
  render(<CitationChip title="[S1] Welcome" kind="wiki" slug="welcome" />);
  const link = screen.getByRole("link", { name: "[S1] Welcome" });
  expect(link).toHaveAttribute("href", "/wiki/page/welcome");
  expect(link).not.toHaveAttribute("target");

  await user.click(link);
  expect(spy).toHaveBeenCalledWith("welcome");
});
