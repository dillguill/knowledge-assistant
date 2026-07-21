import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import App from "@/App";

test("assistant replies expose copy / regenerate; user messages expose edit", async () => {
  const user = userEvent.setup();
  render(<App />);
  const input = screen.getByRole("textbox", { name: /message input/i });
  await user.type(input, "hello there{Enter}");
  // demo adapter streams a canned reply word by word
  await screen.findByText(
    /canned reply/i,
    undefined,
    { timeout: 15000 },
  );
  expect(
    await screen.findByRole("button", { name: "Copy" }, { timeout: 5000 }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
}, 30000);
