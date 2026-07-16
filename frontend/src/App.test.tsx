import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the app without crashing", () => {
  const { container } = render(<App />);
  expect(container.firstChild).not.toBeNull();
});

test("sidebar offers a New Chat button", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /new chat/i })).toBeInTheDocument();
});
