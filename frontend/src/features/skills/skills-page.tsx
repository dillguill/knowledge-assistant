import { useEffect, useState } from "react";
import { requestWikiProposals } from "@/app/wiki-navigation";
import { KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <Card className="gap-3 p-4 shadow-raised">
      <div className="flex items-start gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-heading">{skill.label}</h3>
          <p className="text-meta text-muted-foreground">{skill.description}</p>
        </div>
      </div>
      <SkillForm skill={skill} onSubmit={onSubmit} submitting={submitting} />
    </Card>
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
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
        <h1 className="text-display">Skills</h1>
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <KeyRound className="size-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="text-heading">Owner access required</p>
          <p className="max-w-sm text-body text-muted-foreground">
            Running a skill needs an owner token — add one in Settings. Skills
            spend a shared model allowance, so they stay owner-only.
          </p>
        </div>
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
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-display">Skills</h1>
        <p className="max-w-prose text-body text-muted-foreground">
          Multi-step runs that research, draft, and file a wiki proposal for
          your approval. Nothing they write lands without your review.
        </p>
      </header>

      {error && (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
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
        <h2 className="text-heading">Recent runs</h2>
        <RunHistory runs={runs} onOpen={(id) => setView({ kind: "run", id })} />
      </section>
    </div>
  );
}
