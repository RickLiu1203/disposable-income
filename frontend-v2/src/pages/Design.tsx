import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Dropdown,
  Input,
  LineChart,
  ListRow,
  LlmLogo,
  Modal,
  Skeleton,
  Sparkline,
  StatTile,
  Toast,
  Toggle,
} from "../design-system";
import { deltaColor } from "../lib/deltaColor";
import { cx } from "../lib/cx";

const typeScale = [
  { token: "text-2xl", sample: "Match summary" },
  { token: "text-xl", sample: "Kalshi vs. Polymarket" },
  { token: "text-lg", sample: "World Cup Advance" },
  { token: "text-md", sample: "Section heading" },
  { token: "text-base", sample: "Body text and table cells" },
  { token: "text-sm", sample: "Metadata, timestamps, labels" },
  { token: "text-xs", sample: "Captions and badges" },
] as const;

const spacingScale = [
  "3xs",
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
] as const;

const models = [
  {
    label: "CL",
    shortName: "Claude",
    title: "Claude Sonnet 5",
    balance: "$14.82",
    delta: "+18.4%",
    positive: true,
    trend: "up" as const,
    history: [10.00, 11.20, 10.80, 12.50, 13.90, 13.10, 14.82],
  },
  {
    label: "GP",
    shortName: "GPT-5.1",
    title: "GPT-5.1",
    balance: "$9.15",
    delta: "-3.2%",
    positive: false,
    trend: "down" as const,
    history: [10.00, 9.40, 10.60, 9.80, 8.90, 9.50, 9.15],
  },
  {
    label: "GM",
    shortName: "Gemini",
    title: "Gemini 3 Pro",
    balance: "$11.40",
    delta: "+2.1%",
    positive: true,
    trend: "up" as const,
    history: [10.00, 10.60, 9.90, 10.80, 11.50, 10.90, 11.40],
  },
];

const matches = ["7/1", "7/3", "7/5", "7/7", "7/9", "7/11", "7/13"];

const sortOptions = [
  { label: "Balance", value: "balance" },
  { label: "Win rate", value: "winrate" },
  { label: "Recent form", value: "recent" },
];

function Design() {
  const [outcome, setOutcome] = useState("Yes");
  const [sortBy, setSortBy] = useState("balance");
  const [toastOpen, setToastOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 text-neutral-900">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-tight text-neutral-500">
          Design tokens
        </p>
        <h1 className="text-2xl font-medium tracking-tight">
          frontend-v2 foundations
        </h1>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">
          Typography
        </h2>
        <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {typeScale.map(({ token, sample }) => (
            <div key={token} className="flex items-baseline gap-4 px-4 py-3">
              <span className="w-16 shrink-0 font-mono text-xs text-neutral-400">
                {token}
              </span>
              <span className={token}>{sample}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Spacing</h2>
        <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 p-4">
          {spacingScale.map((step) => (
            <div key={step} className="flex items-center gap-3">
              <span className="w-10 shrink-0 font-mono text-xs text-neutral-400">
                {step}
              </span>
              <div
                className="h-3 bg-neutral-800"
                style={{ width: `var(--space-${step})` }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">
          Components
        </h2>
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="mb-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Button
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary">Place prediction</Button>
              <Button variant="secondary">View rules</Button>
            </div>
          </div>

          <div className="mb-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Chip
            </div>
            <div className="flex items-center gap-2">
              <Chip variant="neutral">Open</Chip>
              <Chip variant="primary">Live</Chip>
              <Chip variant="secondary">Settled</Chip>
              <Chip variant="success">Won</Chip>
              <Chip variant="error">Lost</Chip>
            </div>
          </div>

          <div className="mb-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              2-choice toggle
            </div>
            <Toggle
              options={["Yes", "No"]}
              value={outcome}
              onChange={setOutcome}
            />
          </div>

          <div className="mb-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              List
            </div>
            <div>
              {models.map((model) => (
                <ListRow
                  key={model.title}
                  logo={<LlmLogo label={model.label} />}
                  title={model.title}
                  subtitle={
                    <>
                      {model.balance} &middot;{" "}
                      <span className={cx("font-semibold", deltaColor(model.positive))}>
                        {model.delta}
                      </span>
                    </>
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Card
            </div>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">
                    Nigeria vs. Nicaragua
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    KXWCADVANCE &middot; World Cup Advance
                  </div>
                </div>
                <Chip variant="primary">Live</Chip>
              </div>
              <div className="my-4 flex gap-6">
                <div>
                  <div className="text-lg font-bold tabular-nums">62&cent;</div>
                  <div className="text-xs text-neutral-500">Yes</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums">38&cent;</div>
                  <div className="text-xs text-neutral-500">No</div>
                </div>
              </div>
              <Button variant="secondary">View match</Button>
            </Card>
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Skeleton
            </div>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
                <Skeleton className="h-5 w-14 shrink-0" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-2.5 w-12" />
              </div>
              <Skeleton className="mt-4 h-8 w-full" />
            </Card>
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Stat tile
            </div>
            <div className="flex gap-3">
              {models.map((model) => (
                <StatTile
                  key={model.title}
                  label={model.title}
                  value={model.balance}
                  delta={model.delta}
                  trend={model.trend}
                  icon={<LlmLogo label={model.label} size="sm" />}
                  sparkline={model.history}
                />
              ))}
            </div>
          </div>

          <div className="mt-6 max-w-64">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Input
            </div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Kalshi URL
            </label>
            <Input type="text" placeholder="https://kalshi.com/markets/..." />
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Toast
            </div>
            {toastOpen ? (
              <Toast
                variant="success"
                title="Prediction placed"
                message="GPT-5.1 predicted Yes at 62¢ on KXWCADVANCE."
                onDismiss={() => setToastOpen(false)}
              />
            ) : (
              <Button variant="secondary" onClick={() => setToastOpen(true)}>
                Show toast
              </Button>
            )}
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Dropdown
            </div>
            <Dropdown options={sortOptions} value={sortBy} onChange={setSortBy} />
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Modal
            </div>
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              Open modal
            </Button>
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Modal title">
              <p className="text-sm text-neutral-600">
                Modal body content goes here.
              </p>
            </Modal>
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Line chart
            </div>
            <LineChart
              xLabels={matches}
              series={models.map((model) => ({
                key: model.label,
                name: model.title,
                shortName: model.shortName,
                badge: model.label,
                values: model.history,
                positive: model.positive,
                delta: model.delta,
              }))}
            />
          </div>

          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Sparkline
            </div>
            <div className="flex items-center gap-6">
              <Sparkline points={[12, 18, 15, 22, 28, 26, 34]} />
              <Sparkline points={[34, 30, 31, 24, 20, 18, 12]} />
              <Sparkline points={[20, 21, 19, 20, 22, 19, 20]} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Design;
