import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComposerAttachments } from "./attachment";

// AttachmentUI (rendered per attachment) uses a raw Radix <Tooltip>, which
// throws unless a <TooltipProvider> is mounted somewhere above it. Mock the
// assistant-ui hooks/primitives so a single document attachment renders.
const fakeState = {
  attachment: {
    type: "document",
    source: "composer",
    file: undefined,
    content: [],
    status: { type: "complete" },
    name: "note.txt",
  },
};

vi.mock("@assistant-ui/react", () => ({
  useAui: () => ({ attachment: { source: "composer" } }),
  useAuiState: (selector: (s: typeof fakeState) => unknown) =>
    selector(fakeState),
  AttachmentPrimitive: {
    Root: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Name: () => <span>note.txt</span>,
    Remove: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
  ComposerPrimitive: {
    Attachments: ({ children }: { children: () => ReactNode }) => children(),
  },
  MessagePrimitive: {
    Attachments: ({ children }: { children: () => ReactNode }) => children(),
  },
}));

test("attachment tile crashes without a TooltipProvider (the upload-crash bug)", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<ComposerAttachments />)).toThrow(/TooltipProvider/);
  spy.mockRestore();
});

test("attachment tile renders when a TooltipProvider is present", () => {
  render(
    <TooltipProvider>
      <ComposerAttachments />
    </TooltipProvider>,
  );
  expect(screen.getByRole("button", { name: /Document attachment/i })).toBeInTheDocument();
});
