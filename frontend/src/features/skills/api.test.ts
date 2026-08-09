import { beforeEach, expect, test, vi } from "vitest";
import { SETTINGS_KEY } from "@/features/settings/settings-storage";
import { cancelRun, getRun, listRuns, listSkills, startRun, streamRun } from "./api";

const OWNER = JSON.stringify({ ownerToken: "tok" });

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

test("listSkills unwraps the skills array", async () => {
  vi.stubGlobal("fetch", respond({ skills: [{ name: "research_brief" }] }));
  expect((await listSkills())[0].name).toBe("research_brief");
});

test("startRun posts the skill, model, and inputs with the owner header", async () => {
  localStorage.setItem(SETTINGS_KEY, OWNER);
  const fetchMock = respond({ run_id: 7, status: "queued" }, 201);
  vi.stubGlobal("fetch", fetchMock);

  const run = await startRun("research_brief", "m:free", { topic: "sqlite" });

  expect(run.run_id).toBe(7);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toMatch(/\/api\/skills\/run$/);
  expect(init.headers["X-Owner-Token"]).toBe("tok");
  expect(JSON.parse(init.body)).toEqual({
    skill: "research_brief",
    model: "m:free",
    inputs: { topic: "sqlite" },
  });
});

test("a 409 reads as a real state, not a generic failure", async () => {
  // The one concurrency affordance a user will actually hit.
  vi.stubGlobal("fetch", respond({ detail: "A run is already in progress." }, 409));
  await expect(startRun("research_brief", null, {})).rejects.toThrow(
    /already in progress/i,
  );
});

test("a 422 surfaces the backend's validation detail", async () => {
  vi.stubGlobal("fetch", respond({ detail: "topic: too short" }, 422));
  await expect(startRun("research_brief", null, {})).rejects.toThrow(/too short/i);
});

test("a 401 points at settings, matching the knowledge client", async () => {
  vi.stubGlobal("fetch", respond({}, 401));
  await expect(listSkills()).rejects.toThrow(/set it in settings/i);
});

test("getRun returns the run and its steps", async () => {
  vi.stubGlobal(
    "fetch",
    respond({ run: { id: 1, status: "running" }, steps: [{ ordinal: 1, name: "plan" }] }),
  );
  const { run, steps } = await getRun(1);
  expect(run.status).toBe("running");
  expect(steps[0].name).toBe("plan");
});

test("listRuns unwraps the runs array", async () => {
  vi.stubGlobal("fetch", respond({ runs: [{ id: 2 }, { id: 1 }] }));
  expect((await listRuns()).map((r) => r.id)).toEqual([2, 1]);
});

test("cancelRun posts to the cancel endpoint", async () => {
  localStorage.setItem(SETTINGS_KEY, OWNER);
  const fetchMock = respond({ run_id: 3, status: "cancelled" });
  vi.stubGlobal("fetch", fetchMock);

  await cancelRun(3);

  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toMatch(/\/api\/skills\/runs\/3\/cancel$/);
  expect(init.method).toBe("POST");
});

test("cancelling a finished run reads as already-finished, not an error state", async () => {
  vi.stubGlobal("fetch", respond({ detail: "That run has already finished." }, 409));
  await expect(cancelRun(3)).rejects.toThrow(/already finished/i);
});

test("streamRun yields parsed events and stops at [DONE]", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"run-start"}\n\n'));
      controller.enqueue(encoder.encode('data: {"type":"step-start","ordinal":1}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

  const seen = [];
  for await (const event of streamRun(1)) seen.push(event);

  expect(seen.map((e) => e.type)).toEqual(["run-start", "step-start"]);
});

test("streamRun sends the owner token, since EventSource cannot", async () => {
  localStorage.setItem(SETTINGS_KEY, OWNER);
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(new ReadableStream({ start: (c) => c.close() })));
  vi.stubGlobal("fetch", fetchMock);

  for await (const _ of streamRun(1)) void _;

  expect(fetchMock.mock.calls[0][1].headers["X-Owner-Token"]).toBe("tok");
});

test("streamRun throws when the response has no body", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
  await expect(async () => {
    for await (const _ of streamRun(1)) void _;
  }).rejects.toThrow();
});
