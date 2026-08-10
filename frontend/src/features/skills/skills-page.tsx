import { useEffect, useState } from "react";
import { requestWikiProposals } from "@/app/wiki-navigation";
import { Button } from "@/components/ui/button";
import { useModelSelection } from "@/features/chat/chat-provider";
import { loadSettings } from "@/features/settings/settings-storage";
import { getRun, listRuns, listSkills, startRun, type Run, type SkillSummary } from "./api";
import { RunHistory } from "./run-history";
import { RunView } from "./run-view";
import { SkillForm } from "./skill-form";

type View = { kind: "list" } | { kind: "run"; id: number };

function SkillCard({
  skill,
  onSubmit,
  submitting,
}: {
  skill: SkillSummary;
  onSubmit: (inputs: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{skill.label}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
      <div className="mt-4">
        <SkillForm skill={skill} onSubmit={onSubmit} submitting={submitting} />
      </div>
    </section>
  );
}

/** Run outcome actions, shown once a run has finished. Uses the module-level
 * pub/sub bridge to reach the wiki rather than introducing a router. */
function RunActions({ runId }: { runId: number }) {
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    let live = true;
    void getRun(runId)
      .then(({ run: loaded }) => live && setRun(loaded))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runId]);

  if (run?.status !== "succeeded" || typeof run.output?.proposal_id !== "number") {
    return null;
  }
  return (
    <Button size="sm" variant="outline" onClick={() => requestWikiProposals()}>
      Review proposal
    </Button>
  );
}

export function SkillsPage() {
  const isOwner = Boolean(loadSettings().ownerToken);
  const { model } = useModelSelection();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let live = true;
    void (async () => {
      try {
        const [loadedSkills, loadedRuns] = await Promise.all([listSkills(), listRuns()]);
        if (!live) return;
        setSkills(loadedSkills);
        setRuns(loadedRuns);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load skills.");
      }
    })();
    return () => {
      live = false;
    };
  }, [isOwner]);

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h2 className="text-base font-semibold">Skills</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Running a skill needs an owner token — add one in Settings. Skills spend
          a shared model allowance, so they stay owner-only.
        </p>
      </div>
    );
  }

  async function handleRun(name: string, inputs: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      const { run_id } = await startRun(name, model, inputs);
      setView({ kind: "run", id: run_id });
      setRuns(await listRuns().catch(() => runs));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start that run.");
    } finally {
      setSubmitting(false);
    }
  }

  if (view.kind === "run") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <Button size="sm" variant="ghost" onClick={() => setView({ kind: "list" })}>
            ← Back to skills
          </Button>
          <RunActions runId={view.id} />
        </div>
        <RunView runId={view.id} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {skills.map((skill) => (
          <SkillCard
            key={skill.name}
            skill={skill}
            submitting={submitting}
            onSubmit={(inputs) => void handleRun(skill.name, inputs)}
          />
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Recent runs</h3>
        <RunHistory runs={runs} onOpen={(id) => setView({ kind: "run", id })} />
      </section>
    </div>
  );
}
