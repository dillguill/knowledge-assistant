import { beforeEach, expect, test, vi } from "vitest";
import { exportPageAsMarkdown, exportPageAsPdf } from "./export";

beforeEach(() => {
  vi.restoreAllMocks();
});

test("exportPageAsMarkdown downloads a markdown blob named {slug}.md", () => {
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const createElementSpy = vi.spyOn(document, "createElement");

  exportPageAsMarkdown("welcome", "# Hello wiki");

  const anchor = createElementSpy.mock.results.find(
    (r) => r.value instanceof HTMLAnchorElement,
  )?.value as HTMLAnchorElement;

  expect(createObjectURL).toHaveBeenCalledTimes(1);
  const blob = createObjectURL.mock.calls[0]![0] as Blob;
  expect(blob.type).toBe("text/markdown");
  expect(clickSpy).toHaveBeenCalledTimes(1);
  expect(anchor.download).toBe("welcome.md");
  expect(anchor.href).toBe("blob:mock-url");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
});

test("exportPageAsPdf triggers the browser print dialog", () => {
  const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

  exportPageAsPdf();

  expect(printSpy).toHaveBeenCalledTimes(1);
});
