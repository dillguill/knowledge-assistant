import { expect, test, vi } from "vitest";
import { bumpWikiData, onWikiDataChange } from "./wiki-refresh";

test("bumpWikiData notifies every current subscriber", () => {
  const a = vi.fn();
  const b = vi.fn();
  const offA = onWikiDataChange(a);
  const offB = onWikiDataChange(b);

  bumpWikiData();

  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  offA();
  offB();
});

test("unsubscribing stops further notifications", () => {
  const fn = vi.fn();
  const off = onWikiDataChange(fn);
  off();

  bumpWikiData();

  expect(fn).not.toHaveBeenCalled();
});
