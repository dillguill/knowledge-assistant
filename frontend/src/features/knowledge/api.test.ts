import { beforeEach, expect, test, vi } from "vitest";
import { createCollection, listCollections, rawFileUrl, uploadFile } from "./api";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

test("createCollection sends the owner token header from settings", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 1, name: "Garage", file_count: 0 }), {
      status: 201,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const col = await createCollection("Garage");
  expect(col.name).toBe("Garage");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toMatch(/\/api\/knowledge\/collections$/);
  expect(init.headers["X-Owner-Token"]).toBe("tok");
});

test("401 surfaces a settings-pointing error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
  await expect(createCollection("X")).rejects.toThrow(/set it in settings/i);
});

test("uploadFile posts multipart form data", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 2, filename: "a.md" }), { status: 201 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await uploadFile(1, new File(["# hi"], "a.md", { type: "text/markdown" }));
  const [, init] = fetchMock.mock.calls[0];
  expect(init.body).toBeInstanceOf(FormData);
});

test("listCollections unwraps the envelope; rawFileUrl builds the link", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ collections: [] }), { status: 200 }),
  ));
  expect(await listCollections()).toEqual([]);
  expect(rawFileUrl(7)).toMatch(/\/api\/knowledge\/files\/7\/raw$/);
});
