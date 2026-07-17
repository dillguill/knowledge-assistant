import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

test("renders the app without crashing", () => {
  const { container } = render(<App />);
  expect(container.firstChild).not.toBeNull();
});

test("sidebar offers a New Chat button", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /new chat/i })).toBeInTheDocument();
});

test("nav switches to Settings and back to Chat", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByLabelText("System prompt")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Chat" }));
  expect(screen.queryByLabelText("System prompt")).not.toBeInTheDocument();
});
