import { beforeEach, expect, test, vi } from "vitest";
import {
  approveProposal,
  createFolder,
  createProposal,
  getTree,
  listProposals,
  patchFolder,
  searchPages,
  updatePage,
} from "./api";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

test("createFolder (a write) sends the owner token header from settings", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ id: 1, name: "Guides", parent_id: null, position: 0, created_at: "now" }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const folder = await createFolder("Guides", null);
  expect(folder.name).toBe("Guides");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toMatch(/\/api\/wiki\/folders$/);
  expect(init.headers["X-Owner-Token"]).toBe("tok");
});

test("getTree (a read) does not send an owner token header", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ folders: [], pages: [] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const tree = await getTree();
  expect(tree).toEqual({ folders: [], pages: [] });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toMatch(/\/api\/wiki\/tree$/);
  expect(init?.headers?.["X-Owner-Token"]).toBeUndefined();
});

test("patchFolder omits unset fields so the backend leaves them untouched", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ id: 1, name: "Renamed", parent_id: null, position: 0, created_at: "now" }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await patchFolder(1, { name: "Renamed" });
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({ name: "Renamed" });
});

test("401 surfaces a settings-pointing error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
  await expect(createFolder("X", null)).rejects.toThrow(/set it in settings/i);
});

test("409 surfaces the conflict message from the response body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "A folder with that name already exists." }), {
        status: 409,
      }),
    ),
  );
  await expect(createFolder("Dup", null)).rejects.toThrow(/already exists/i);
});

test("429 surfaces the rate-limit message from a nested detail object", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: { code: "rate_limited", message: "Free-tier rate limit hit — wait a moment and retry." },
        }),
        { status: 429 },
      ),
    ),
  );
  await expect(
    createProposal({ title: "X", folder_id: null, content: "hi" }),
  ).rejects.toThrow(/rate limit/i);
});

test("429 without a JSON body still surfaces a readable error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
  await expect(listProposals()).rejects.toThrow(/rate limited/i);
});

test("updatePage PUTs content and note", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 1,
        folder_id: null,
        title: "Welcome",
        slug: "welcome",
        position: 0,
        updated_at: "now",
        last_author: "owner",
        content: "# hi",
        last_version: { author: "owner", created_at: "now", note: "edit" },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const page = await updatePage(1, "# hi", "edit");
  expect(page.content).toBe("# hi");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toMatch(/\/api\/wiki\/pages\/1$/);
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ content: "# hi", note: "edit" });
});

test("searchPages unwraps the results envelope", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ results: [{ id: 1, title: "Welcome", slug: "welcome", snippet: "hi [there]" }] }),
        { status: 200 },
      ),
    ),
  );
  const results = await searchPages("there");
  expect(results).toHaveLength(1);
  expect(results[0].slug).toBe("welcome");
});

test("approveProposal (a write) sends the owner token header", async () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ownerToken: "tok" }));
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 1,
        folder_id: null,
        title: "Welcome",
        slug: "welcome",
        position: 0,
        updated_at: "now",
        last_author: "assistant",
        content: "hi",
        last_version: null,
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await approveProposal(5);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toMatch(/\/api\/wiki\/proposals\/5\/approve$/);
  expect(init.headers["X-Owner-Token"]).toBe("tok");
});
