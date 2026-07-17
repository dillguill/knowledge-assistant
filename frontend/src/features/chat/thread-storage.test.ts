import { browserThreadStorage, STORAGE_PREFIX } from "./thread-storage";

test("round-trips values through localStorage", async () => {
  await browserThreadStorage.setItem(`${STORAGE_PREFIX}probe`, "value-1");
  expect(await browserThreadStorage.getItem(`${STORAGE_PREFIX}probe`)).toBe(
    "value-1",
  );
  await browserThreadStorage.removeItem(`${STORAGE_PREFIX}probe`);
  expect(await browserThreadStorage.getItem(`${STORAGE_PREFIX}probe`)).toBeNull();
});
