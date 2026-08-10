import type { ReactNode } from "react";
import { BarChart3, Coins, Gauge, Target, Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PlaceholderBars,
  PlaceholderLines,
  Unavailable,
} from "@/components/ui/unavailable";

/**
 * The Analytics shell.
 *
 * This whole page is a slot, not a feature: v0.8.0 owns cost and quality
 * reporting, and v0.7.0 owns the retrieval evaluation that feeds it. It ships
 * now so the section exists, is navigable, and states plainly what will land
 * where — a frontend to plug into rather than a nav item that goes nowhere.
 *
 * Every panel is wrapped in `Unavailable`, which makes its contents inert and
 * hidden from assistive technology. Nothing here displays a measured figure,
 * because the product has not measured one yet — the placeholders are shapes.
 */

function PanelBody({
  icon: Icon,
  heading,
  children,
}: {
  icon: typeof Gauge;
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 pb-14">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-heading">{heading}</span>
      </div>
      {children}
    </div>
  );
}

export function AnalyticsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2.5 text-display">
            <BarChart3 className="size-6 text-muted-foreground" aria-hidden />
            Analytics
          </h1>
          <p className="max-w-prose text-body text-muted-foreground">
            Cost and quality reporting for chat answers and skill runs. Nothing
            here is live yet — the panels below show where each measure will
            appear once the milestone that owns it lands.
          </p>
        </header>

        <Tabs defaultValue="cost">
          <TabsList>
            <TabsTrigger value="cost">
              <Coins aria-hidden />
              Cost
            </TabsTrigger>
            <TabsTrigger value="quality">
              <Target aria-hidden />
              Quality
            </TabsTrigger>
            <TabsTrigger value="latency">
              <Timer aria-hidden />
              Latency
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cost">
            <div className="grid items-start gap-4 md:grid-cols-2">
              <Unavailable
                title="Spend by model"
                milestone="v0.8.0"
                note="Token counts per step are already recorded; this turns them into cost."
              >
                <PanelBody icon={Coins} heading="Spend by model">
                  <PlaceholderBars rows={6} />
                </PanelBody>
              </Unavailable>

              <Unavailable
                title="Free-tier allowance"
                milestone="v0.8.0"
                note="OpenRouter and Firecrawl usage against the daily and monthly caps."
              >
                <PanelBody icon={Gauge} heading="Free-tier allowance">
                  <PlaceholderLines rows={4} />
                </PanelBody>
              </Unavailable>

              <Unavailable
                title="Cost per run"
                milestone="v0.8.0"
                note="What a research brief actually costs, broken down by step."
                className="md:col-span-2"
              >
                <PanelBody icon={Coins} heading="Cost per run">
                  <PlaceholderLines rows={5} />
                </PanelBody>
              </Unavailable>
            </div>
          </TabsContent>

          <TabsContent value="quality">
            <div className="grid items-start gap-4 md:grid-cols-2">
              <Unavailable
                title="Retrieval quality"
                milestone="v0.7.0"
                note="Context precision and recall from the retrieval-only benchmark."
              >
                <PanelBody icon={Target} heading="Retrieval quality">
                  <PlaceholderBars rows={5} />
                </PanelBody>
              </Unavailable>

              <Unavailable
                title="Answer accuracy"
                milestone="v0.7.0"
                note="Faithfulness and answer relevancy, graded per question."
              >
                <PanelBody icon={Target} heading="Answer accuracy">
                  <PlaceholderBars rows={5} />
                </PanelBody>
              </Unavailable>

              <Unavailable
                title="Unsupported claims"
                milestone="v0.7.0"
                note="Claims a run filed without a citation, over time. The verify step already produces this list per run."
                className="md:col-span-2"
              >
                <PanelBody icon={Target} heading="Unsupported claims">
                  <PlaceholderLines rows={4} />
                </PanelBody>
              </Unavailable>
            </div>
          </TabsContent>

          <TabsContent value="latency">
            <div className="grid items-start gap-4 md:grid-cols-2">
              <Unavailable
                title="Time to first token"
                milestone="v0.8.0"
                note="Including the cold-start penalty when the Space has been asleep."
              >
                <PanelBody icon={Timer} heading="Time to first token">
                  <PlaceholderBars rows={7} />
                </PanelBody>
              </Unavailable>

              <Unavailable
                title="Step duration"
                milestone="v0.8.0"
                note="Per-step latency is already recorded on every run; this aggregates it."
              >
                <PanelBody icon={Timer} heading="Step duration">
                  <PlaceholderLines rows={4} />
                </PanelBody>
              </Unavailable>
            </div>
          </TabsContent>
        </Tabs>

        <Card className="gap-2 border-dashed p-4">
          <p className="text-heading">Why this page is empty</p>
          <p className="max-w-prose text-body text-muted-foreground">
            The harness already records what most of these panels need — model,
            token counts, latency and status for every step of every run. What
            is missing is the aggregation and the evaluation set, which v0.7.0
            and v0.8.0 own. The panels are here so those milestones fill a slot
            rather than redesign a page.
          </p>
        </Card>
      </div>
    </div>
  );
}
