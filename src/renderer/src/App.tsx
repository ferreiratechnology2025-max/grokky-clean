import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Brain,
  CaretDown,
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  CursorClick,
  DesktopTower,
  Eye,
  FileText,
  FolderOpen,
  GearSix,
  GlobeHemisphereWest,
  FloppyDisk,
  MagnifyingGlass,
  Monitor,
  PaperPlaneRight,
  PlugsConnected,
  Plus,
  PuzzlePiece,
  Robot,
  ShieldCheck,
  Sparkle,
  SlidersHorizontal,
  Stop,
  TerminalWindow,
  Trash,
  UserPlus,
  UsersThree,
  WarningCircle,
  WifiHigh,
  Wrench,
  X,
} from "@phosphor-icons/react";
import type {
  AccentPalette,
  ActivityItem,
  AgentDefinition,
  AgentDraft,
  AgentIcon,
  AgentRun,
  AppSnapshot,
  CapabilitiesSnapshot,
  ComputerAccessLevel,
  ComputerApprovalDecision,
  ComputerApprovalRequest,
  ComputerCapabilityId,
  Conversation,
  CrewCommunication,
  ProviderId,
  ReasoningEffort,
  RunOutcome,
  SandboxMode,
  SkillCapability,
} from "../../shared/contracts";
import { CODEX_MODELS } from "../../shared/contracts";
import { requiresDevelopmentCommands, requiresProjectDirectory } from "../../shared/run-preflight";
import { botVariantAt, botVariantForIdentity, type BotVariant } from "./bot-identity";
import { ModelCombobox, SelectMenu, type SelectChoice } from "./Controls";
import { activitiesForDisplay, type DisplayActivity } from "./activity-display";
import { crewRunsForDisplay, crewRunStage, groupCrewCommunications } from "./crew-display";
import { getLanguage, setLanguage, t, tn, tr, useStrings, type UiLanguage } from "./i18n/useStrings";

const OPENROUTER_SUGGESTIONS = [
  "openai/gpt-5.2",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-3.1-pro-preview",
  "minimax/minimax-m2",
];

const CODEX_MODEL_CHOICES: Array<SelectChoice<string>> = CODEX_MODELS.map((model) => ({ value: model, label: model }));
const REASONING_CHOICES: Array<SelectChoice<ReasoningEffort>> = [
  { value: "low", label: "Low", detail: "Fast and economical" },
  { value: "medium", label: "Medium", detail: "Balanced for everyday work" },
  { value: "high", label: "High", detail: "Deeper analysis" },
  { value: "xhigh", label: "X-high", detail: "Maximum deliberation" },
];
const OPTIONAL_REASONING_CHOICES: Array<SelectChoice<ReasoningEffort | "">> = [
  { value: "", label: "Inherit from chat" },
  ...REASONING_CHOICES,
];
const SANDBOX_CHOICES: Array<SelectChoice<SandboxMode>> = [
  { value: "workspace-write", label: "Read and write", detail: "Changes stay inside this workspace" },
  { value: "read-only", label: "Read-only", detail: "Inspect without changing files" },
];
const OPTIONAL_MODEL_CHOICES: Array<SelectChoice<string>> = [
  { value: "", label: "Inherit from chat", detail: "Follow the active conversation" },
  ...CODEX_MODEL_CHOICES,
];
const OPTIONAL_SANDBOX_CHOICES: Array<SelectChoice<SandboxMode | "">> = [
  { value: "", label: "Inherit from chat", detail: "Follow the active conversation" },
  ...SANDBOX_CHOICES,
];
const AGENT_SCOPE_CHOICES: Array<SelectChoice<AgentDraft["scope"]>> = [
  { value: "personal", label: "Personal", detail: "Available across your workspaces" },
  { value: "project", label: "This project", detail: "Stored with this workspace" },
];
const COMPUTER_ACCESS_CHOICES: Array<SelectChoice<ComputerAccessLevel>> = [
  { value: "blocked", label: "Blocked", detail: "Never allow this capability" },
  { value: "ask", label: "Ask each time", detail: "Pause for your approval" },
  { value: "allow", label: "Always allow", detail: "Allow within the configured boundary" },
];
function languageChoices(): Array<SelectChoice<UiLanguage>> {
  return [
    { value: "pt-BR", label: t("lang.pt") },
    { value: "en", label: t("lang.en") },
  ];
}
function maxAgentChoices(): Array<SelectChoice<number>> {
  return Array.from({ length: 8 }, (_, index) => ({ value: index + 1, label: tn("choice.worker", index + 1) }));
}
const THEME_CHOICES: Array<SelectChoice<AppSnapshot["settings"]["theme"]>> = [
  { value: "system", label: "Follow system", detail: "Match your operating system automatically" },
  { value: "dark", label: "Dark", detail: "Grokky's cinematic workspace" },
  { value: "light", label: "Light", detail: "Bright, high-contrast workspace" },
];
const SIGNAL_PALETTES: Array<{ id: AccentPalette; label: string; detail: string }> = [
  { id: "lime", label: "Acid lime", detail: "Original Grokky signal" },
  { id: "electric-blue", label: "Electric blue", detail: "Blue current on black" },
  { id: "ultraviolet", label: "Ultraviolet", detail: "Cool violet instrument light" },
  { id: "solar-amber", label: "Solar amber", detail: "Warm high-visibility glow" },
  { id: "ice", label: "Ice", detail: "Clean cyan-white signal" },
];

type BotMood = "idle" | "thinking" | "working" | "success" | "error";
type BotSize = "micro" | "xs" | "sm" | "md" | "lg" | "hero";
type SettingsTab = "session" | "computer" | "skills" | "agents" | "mcp" | "connectors";

const BOT_ASSETS: Record<BotVariant, string> = {
  lime: "./mascots/grokky-hero.png",
  cyan: "./mascots/grokky-thinking.png",
  coral: "./mascots/grokky-working.png",
  violet: "./mascots/grokky-thinking.png",
  amber: "./mascots/grokky-working.png",
  mint: "./mascots/grokky-hero.png",
};

const STARTERS: Array<{ prompt: string; title: string; mood: BotMood }> = [
  { prompt: "Map this repository and explain the architecture.", title: "Map this workspace", mood: "thinking" },
  { prompt: "Find the highest-risk technical debt in this workspace.", title: "Find the risky parts", mood: "idle" },
  { prompt: "Build the next useful feature and verify it.", title: "Build the next feature", mood: "working" },
];

const AGENT_TEMPLATES: Array<AgentDraft & { label: string }> = [
  {
    label: "Explorer",
    name: "code_explorer",
    description: "Read-only explorer for tracing code paths and gathering evidence before changes.",
    developerInstructions: "Stay in exploration mode. Trace real execution paths, cite files and symbols, and return concise evidence. Do not edit files.",
    scope: "personal",
    icon: "cyan",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    sandboxMode: "read-only",
  },
  {
    label: "Reviewer",
    name: "reviewer",
    description: "Reviewer focused on correctness, security, regressions, and missing tests.",
    developerInstructions: "Review like an owner. Lead with concrete findings, prioritize real behavior and security risks, and include reproduction steps when possible.",
    scope: "personal",
    icon: "violet",
    model: "gpt-5.6-terra",
    reasoning: "high",
    sandboxMode: "read-only",
  },
  {
    label: "Builder",
    name: "builder",
    description: "Implementation-focused agent for bounded features, fixes, and validation.",
    developerInstructions: "Own the bounded implementation. Keep unrelated files untouched, make defensible changes, run proportionate verification, and report the result.",
    scope: "personal",
    icon: "amber",
    reasoning: "medium",
    sandboxMode: "workspace-write",
  },
  {
    label: "Tester",
    name: "tester",
    description: "Quality agent for reproducing failures, testing edge cases, and collecting evidence.",
    developerInstructions: "Reproduce the behavior before judging it. Exercise normal, empty, error, cancellation, and recovery paths. Report exact steps and observed evidence.",
    scope: "personal",
    icon: "mint",
    model: "gpt-5.6-terra",
    reasoning: "high",
    sandboxMode: "read-only",
  },
];

const AGENT_ICONS: Array<{ id: AgentIcon; label: string }> = [
  { id: "lime", label: "Lime" },
  { id: "cyan", label: "Cyan" },
  { id: "coral", label: "Coral" },
  { id: "violet", label: "Violet" },
  { id: "amber", label: "Amber" },
  { id: "mint", label: "Mint" },
];

function BrandMark({ size = "md", label = "Grokky" }: { size?: "sm" | "md"; label?: string }) {
  return (
    <span className={`brand-mark brand-mark-${size}`} role="img" aria-label={label}>
      <img src="./mascots/grokky-hero.png" alt="" draggable={false} />
    </span>
  );
}

function defaultVariantForMood(mood: BotMood): BotVariant {
  if (mood === "thinking") return "cyan";
  if (mood === "working" || mood === "error") return "coral";
  return "lime";
}

function BotMascot({ mood = "idle", size = "sm", label, className = "", identity, variant }: {
  mood?: BotMood;
  size?: BotSize;
  label?: string;
  className?: string;
  identity?: string;
  variant?: BotVariant;
}) {
  const resolvedVariant = variant ?? (identity ? botVariantForIdentity(identity) : defaultVariantForMood(mood));
  return (
    <span
      className={`bot-mascot bot-${mood} bot-${size} bot-variant-${resolvedVariant} ${className}`.trim()}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span className="bot-ground" />
      <img src={BOT_ASSETS[resolvedVariant]} alt="" draggable={false} />
    </span>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ href, children, ...props }) => <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function visibleActivities(activities: ActivityItem[]): ActivityItem[] {
  return activitiesForDisplay(activities);
}

function conversationMood(conversation: Conversation): BotMood {
  if (conversation.error) return "error";
  if (conversation.status === "running") {
    const current = visibleActivities(conversation.activities).at(-1);
    return current?.kind === "reasoning" || !current ? "thinking" : "working";
  }
  return conversation.messages.at(-1)?.role === "assistant" ? "success" : "idle";
}

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(getLanguage(), { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString(getLanguage(), { month: "short", day: "numeric" });
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function useLiveNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function compactPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length <= 3) return pathname;
  return `…/${parts.slice(-3).join("/")}`;
}

function providerName(provider: ProviderId): string {
  return provider === "codex" ? "Codex" : "OpenRouter";
}

function InlineLoader({ label = t("crew.working"), quiet = false }: { label?: string; quiet?: boolean }) {
  return (
    <span className={`inline-loader ${quiet ? "quiet" : ""}`} role="status" aria-label={label}>
      <i /><i /><i />
    </span>
  );
}

function activityIcon(activity: ActivityItem) {
  const props = { size: 15, weight: "regular" as const };
  if (activity.status === "failed") return <WarningCircle {...props} />;
  if (activity.status === "running") return <InlineLoader label={t("act.inProgress", { label: tr(activity.label) })} quiet />;
  if (activity.kind === "reasoning") return <Brain {...props} />;
  if (activity.kind === "command") return <TerminalWindow {...props} />;
  if (activity.kind === "files") return <FileText {...props} />;
  if (activity.kind === "plan") return <CheckCircle {...props} />;
  return <Wrench {...props} />;
}

function activityStatusLabel(activity: DisplayActivity): string {
  if (activity.status === "running") return activity.count > 1 ? t("act.countRunning", { n: activity.count }) : t("status.inProgress");
  if (activity.status === "failed") return activity.count > 1 ? t("act.countFailed", { n: activity.count }) : t("status.needsAttention");
  return activity.count > 1 ? t("act.countGrouped", { n: activity.count }) : t("status.completed");
}

function ActivityPanel({ activities, running, outcome }: { activities: ActivityItem[]; running: boolean; outcome?: RunOutcome }) {
  const rawVisible = activities.filter((activity) => !activity.detail?.startsWith("Skill descriptions were shortened to fit the skills context budget."));
  const visible = activitiesForDisplay(rawVisible);
  if (!visible.length && !running && !outcome) return null;
  const current = activitiesForDisplay(rawVisible.slice(-1)).at(-1);
  const outcomeLabel = outcome === "blocked"
    ? t("status.blocked")
    : outcome === "failed"
      ? t("status.failed")
      : outcome === "stopped"
        ? t("status.stopped")
        : t("status.delivered");
  return (
    <section className={`activity-panel outcome-${outcome || "running"}`} aria-label={t("act.aria")}>
      <div className="activity-heading">
        <span className={`activity-live-mark ${running ? "running" : "complete"}`} aria-hidden="true"><i /><i /><i /></span>
        <span><strong>{running ? (current?.label ? tr(current.label) : t("act.preparing")) : t("act.summary")}</strong><small>{tn("act.phases", visible.length)} · {tn("act.actions", rawVisible.length)}</small></span>
        <em>{running ? t("status.live") : outcomeLabel}</em>
      </div>
      {!visible.length && running && (
        <div className="activity-skeleton" aria-label={t("act.waiting")}>
          <i /><i /><i />
        </div>
      )}
      {visible.length > 0 && (
        <div className="activity-list">
          {visible.map((activity) => (
            <details className={`activity-row kind-${activity.kind} ${activity.status}`} key={activity.id}>
              <summary>
                <span className="activity-icon">{activityIcon(activity)}</span>
                <span className="activity-label"><strong>{tr(activity.label)}{activity.count > 1 && <b>×{activity.count}</b>}</strong><small>{activityStatusLabel(activity)}</small></span>
                <time>{timeLabel(activity.createdAt)}</time>
                {activity.detail && <CaretDown size={13} />}
              </summary>
              {activity.detail && <pre>{activity.detail}</pre>}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function MessageList({ conversation, agents }: { conversation: Conversation; agents: AgentDefinition[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestUserIndex = conversation.messages.findLastIndex((message) => message.role === "user");
  const crewVisible = conversation.agentRuns.length > 0
    || (conversation.status === "running" && conversation.selectedAgentIds.length > 0);
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [conversation.messages.length, conversation.activities.length, conversation.agentRuns.length, conversation.crewCommunications.length, conversation.status]);

  return (
    <div className="message-scroll" ref={scrollRef}>
      <div className="message-stack">
        {!conversation.messages.length ? (
          <div className="empty-session">
            <div className="bot-stage" aria-label={t("crew.botGroup")}>
              <div className="bot-stage-halo" />
              <BotMascot mood="thinking" variant="cyan" size="md" label={t("crew.botExplorer")} className="stage-bot stage-bot-left" />
              <BotMascot mood="idle" variant="lime" size="lg" label={t("crew.botLead")} className="stage-bot stage-bot-center" />
              <BotMascot mood="working" variant="coral" size="md" label={t("crew.botBuilder")} className="stage-bot stage-bot-right" />
            </div>
            <div className="empty-copy">
              <h1>{t("empty.title")}</h1>
              <p>{t("empty.subtitle")}</p>
              <div className="starter-list">
                {STARTERS.map((starter, index) => (
                  <button key={starter.prompt} type="button" onClick={() => window.dispatchEvent(new CustomEvent("grokky:starter", { detail: tr(starter.prompt) }))}>
                    <BotMascot mood={starter.mood} variant={botVariantAt(index + 1)} size="xs" />
                    <strong>{tr(starter.title)}</strong>
                    <ArrowUpRight className="starter-arrow" size={15} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          conversation.messages.map((message, index) => (
            <article className={`message ${message.role} ${message.role === "user" && index === latestUserIndex && crewVisible ? "with-crew" : ""}`} key={message.id}>
              {message.role === "assistant" && <BotMascot mood="idle" identity={`conversation:${conversation.id}`} size="xs" className="message-avatar" label="Grokky" />}
              <div className="message-body">
                <div className="message-shell">
                  <header>
                    <span>{message.role === "user" ? t("msg.you") : "Grokky"}</span>
                    <time>{timeLabel(message.createdAt)}</time>
                  </header>
                  <div className="message-content"><MarkdownMessage content={message.content} /></div>
                </div>
                {message.role === "user" && index === latestUserIndex && (
                  <>
                    {crewVisible && <CrewRunPanel conversation={conversation} agents={agents} />}
                    {!crewVisible && <ActivityPanel activities={conversation.activities} running={conversation.status === "running"} outcome={conversation.lastRunOutcome} />}
                  </>
                )}
              </div>
            </article>
          ))
        )}
        {conversation.error && (
          <div className="run-error" role="alert"><WarningCircle size={17} />{conversation.error}</div>
        )}
      </div>
    </div>
  );
}

const activeAgentStatuses = new Set<AgentRun["status"]>(["starting", "working", "waiting"]);

function runMood(run: AgentRun): BotMood {
  if (run.id.startsWith("queued:") || run.id.startsWith("unconfirmed:")) return "thinking";
  if (run.status === "failed" || run.status === "stopped") return "error";
  if (run.status === "completed") return "success";
  if (run.status === "waiting") return "thinking";
  return "working";
}

function CrewRunPanel({ conversation, agents }: { conversation: Conversation; agents: AgentDefinition[] }) {
  const runs = crewRunsForDisplay(conversation, agents);
  const stage = crewRunStage(conversation, runs);
  const now = useLiveNow(stage !== "complete");
  const queued = runs.filter((run) => run.id.startsWith("queued:"));
  const unconfirmed = runs.filter((run) => run.id.startsWith("unconfirmed:"));
  const synthetic = new Set([...queued, ...unconfirmed].map((run) => run.id));
  const active = runs.filter((run) => !synthetic.has(run.id) && activeAgentStatuses.has(run.status));
  const reported = runs.filter((run) => run.status === "completed");
  const failed = runs.filter((run) => run.status === "failed" || run.status === "stopped");
  const communications = conversation.crewCommunications;
  const [expanded, setExpanded] = useState(runs.length > 0);
  const [activeTab, setActiveTab] = useState<"overview" | "messages">("overview");
  const avatarRuns = runs.slice(0, 3);
  const startedAt = runs.length ? Math.min(...runs.map((run) => run.createdAt)) : conversation.updatedAt;
  const finishedAt = runs.length ? Math.max(...runs.map((run) => run.updatedAt)) : conversation.updatedAt;
  const elapsed = formatDuration((stage === "complete" ? finishedAt : now) - startedAt);
  const header = stage === "starting"
    ? { title: tn("crewh.requesting", runs.length), detail: tn("crewh.awaiting", unconfirmed.length) }
    : stage === "parallel"
      ? active.length
        ? { title: tn("crewh.working", active.length), detail: queued.length ? t("crewh.queued", { n: queued.length }) : reported.length ? t("crewh.reportsReceived", { r: reported.length, n: runs.length }) : t("crewh.independent") }
        : { title: t("crewh.nextSpecialist"), detail: t("crewh.queued", { n: queued.length }) }
      : stage === "synthesizing"
        ? { title: t("crewh.synthesizing"), detail: tn("crewh.reportsReady", reported.length) }
        : conversation.lastRunOutcome === "blocked" || conversation.lastRunOutcome === "failed"
          ? { title: t("crewh.needsAttention"), detail: failed.length ? t("crewh.reportedStopped", { r: reported.length, f: failed.length }) : t("crewh.confirmedReceived", { r: reported.length, n: runs.length }) }
          : { title: t("crewh.delivered"), detail: tn("crewh.combined", reported.length) };
  useEffect(() => {
    if (stage !== "complete") setExpanded(true);
  }, [stage, conversation.id]);

  useEffect(() => setActiveTab("overview"), [conversation.id]);

  const selectTab = (tab: "overview" | "messages") => {
    setActiveTab(tab);
    setExpanded(true);
  };

  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, tab: "overview" | "messages") => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectTab(tab);
    requestAnimationFrame(() => document.getElementById(`crew-tab-${tab}-${conversation.id}`)?.focus());
  };

  if (!runs.length) return null;
  return (
    <section className={`crew-run-panel stage-${stage} ${stage !== "complete" ? "is-active" : ""}`} aria-label={t("crew.activity")}>
      <div className="crew-run-header">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <span className="crew-avatar-stack" aria-hidden="true">
            {avatarRuns.map((run) => <BotMascot key={run.id} mood={runMood(run)} identity={run.name || run.id} variant={run.icon} size="xs" />)}
          </span>
          <span><strong>{header.title}</strong><small>{header.detail}</small></span>
          <time>{elapsed}</time>
          <CaretDown size={14} />
        </button>
        {conversation.status === "running" && <button className="crew-stop" type="button" onClick={() => void window.grokky.cancelRun(conversation.id)}><Stop size={12} weight="fill" />{t("crew.stop")}</button>}
      </div>
      {expanded && (
        <>
          <div className="crew-tabs" role="tablist" aria-label={t("crew.details")}>
            <button
              id={`crew-tab-overview-${conversation.id}`}
              className="crew-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === "overview"}
              aria-controls={`crew-panel-overview-${conversation.id}`}
              tabIndex={activeTab === "overview" ? 0 : -1}
              onClick={() => selectTab("overview")}
              onKeyDown={(event) => moveTab(event, "messages")}
            >
              <UsersThree size={13} /><span>{t("crew.overview")}</span>
            </button>
            <button
              id={`crew-tab-messages-${conversation.id}`}
              className="crew-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === "messages"}
              aria-controls={`crew-panel-messages-${conversation.id}`}
              tabIndex={activeTab === "messages" ? 0 : -1}
              onClick={() => selectTab("messages")}
              onKeyDown={(event) => moveTab(event, "overview")}
            >
              <PaperPlaneRight size={13} /><span>{t("crew.messages")}</span><small>{communications.length}</small>
            </button>
          </div>
          {activeTab === "overview" ? (
            <div
              id={`crew-panel-overview-${conversation.id}`}
              className="crew-run-body"
              role="tabpanel"
              aria-labelledby={`crew-tab-overview-${conversation.id}`}
            >
              <div className="crew-specialist-lane">
                {runs.map((run) => <CrewRunRow key={run.id} run={run} activities={conversation.activities} now={now} />)}
              </div>
              {stage === "synthesizing" && (
                <div className="crew-run-footer">
                  <div className="crew-lead-node stage-synthesizing">
                    <BotMascot mood="thinking" identity="grokky-lead" variant="lime" size="xs" />
                    <span><strong>{t("crew.lead")}</strong><small>{t("crew.resolving")}</small></span>
                    <em aria-live="polite"><Sparkle size={11} weight="fill" />{t("crew.synthesizing")}</em>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <CrewMailbox
              id={`crew-panel-messages-${conversation.id}`}
              labelledBy={`crew-tab-messages-${conversation.id}`}
              communications={communications}
              running={stage !== "complete"}
            />
          )}
        </>
      )}
    </section>
  );
}

function CrewMailbox({ id, labelledBy, communications, running }: { id: string; labelledBy: string; communications: CrewCommunication[]; running: boolean }) {
  const labels: Record<CrewCommunication["kind"], string> = {
    assignment: t("crew.kind.assignment"),
    message: t("crew.kind.message"),
    report: t("crew.kind.report"),
    status: t("crew.kind.status"),
  };
  const groups = groupCrewCommunications(communications);
  return (
    <section id={id} className="crew-mailbox crew-transcript" role="tabpanel" aria-labelledby={labelledBy}>
      {!groups.length ? (
        <div className="crew-mailbox-empty">
          <span aria-hidden="true"><PaperPlaneRight size={18} /></span>
          <div><strong>{t("crew.noMessages")}</strong><small>{t("crew.firstAssignment")}</small></div>
        </div>
      ) : (
        <ol aria-live="polite">
          {groups.map((group, groupIndex) => {
            const failed = group.entries.some((entry) => entry.status === "failed");
            const reportsOnly = group.entries.every((entry) => entry.kind === "report");
            return (
              <li key={`${group.senderThreadId}:${groupIndex}`} className="crew-message-group">
                <BotMascot mood={failed ? "error" : reportsOnly ? "success" : "working"} identity={group.senderThreadId} variant={group.senderName === "Grokky lead" ? "lime" : undefined} size="xs" />
                <div className="crew-message-group-copy">
                  <header className="crew-message-group-header">
                    <strong>{group.senderName}</strong>
                    {group.entries.length > 1 && <small>{tn("crew.msgCount", group.entries.length)}</small>}
                  </header>
                  <div className="crew-message-stack">
                    {group.entries.map((entry) => (
                      <article key={entry.id} className={`crew-transcript-message kind-${entry.kind} status-${entry.status}`}>
                        <header>
                          <span className="crew-message-recipient"><ArrowRight size={10} weight="bold" />{entry.receiverName}</span>
                          <time>{timeLabel(entry.createdAt)}</time>
                        </header>
                        {entry.content && <div className="crew-mailbox-content"><MarkdownMessage content={entry.content} /></div>}
                        <footer>
                          <span>{labels[entry.kind]}</span>
                          {entry.status !== "completed" && <em><i />{entry.status === "failed" ? t("status.failed") : running ? t("status.inProgress") : t("crew.sent")}</em>}
                        </footer>
                      </article>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function CrewRunRow({ run, activities, now }: { run: AgentRun; activities: ActivityItem[]; now: number }) {
  const currentActivity = activities.filter((activity) => activity.id.startsWith(`${run.threadId}:`)).at(-1);
  const queued = run.id.startsWith("queued:");
  const unconfirmed = run.id.startsWith("unconfirmed:");
  const statusLabel = queued
    ? t("crew.queued")
    : unconfirmed
    ? t("crew.awaitingSpawn")
    : run.status === "starting"
      ? t("crew.connecting")
      : run.status === "waiting"
        ? t("crew.reporting")
        : run.status === "completed"
          ? t("crew.reported")
          : run.status === "failed"
            ? t("status.failed")
            : run.status === "stopped"
              ? t("status.stopped")
              : t("crew.working");
  const isSynthetic = queued || unconfirmed;
  const isActive = !isSynthetic && activeAgentStatuses.has(run.status);
  const duration = formatDuration((isActive ? now : run.updatedAt) - run.createdAt);
  const content = (
    <>
      <BotMascot mood={runMood(run)} identity={run.name || run.id} variant={run.icon} size="xs" />
      <span><strong>{run.name}<time>{duration}</time></strong><small>{currentActivity ? tr(currentActivity.label) : tr(run.task)}</small></span>
      <em><i />{statusLabel}</em>
    </>
  );
  const stateClass = queued ? " is-queued" : unconfirmed ? " is-unconfirmed" : "";
  if (!run.result) return <div className={`crew-run-row status-${run.status}${stateClass}`}>{content}</div>;
  return <details className={`crew-run-row status-${run.status}${stateClass}`}><summary>{content}<CaretDown size={13} /></summary><p>{run.result}</p></details>;
}

function CrewPicker({ conversation, agents, enabled, maxAgents, onOpenAgents, onError }: {
  conversation: Conversation;
  agents: AgentDefinition[];
  enabled: boolean;
  maxAgents: number;
  onOpenAgents(): void;
  onError(error: string): void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const available = agents.filter((agent) => agent.id !== "builtin:default");
  const selected = available.filter((agent) => conversation.selectedAgentIds.includes(agent.id));

  useEffect(() => setOpen(false), [conversation.id]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerAway = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnWindowBlur = () => setOpen(false);
    document.addEventListener("pointerdown", closeOnPointerAway);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerAway);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, [open]);

  async function toggle(agent: AgentDefinition) {
    const exists = conversation.selectedAgentIds.includes(agent.id);
    if (!exists && conversation.selectedAgentIds.length >= maxAgents) {
      onError(t("crew.capped", { n: maxAgents }));
      return;
    }
    const next = exists
      ? conversation.selectedAgentIds.filter((id) => id !== agent.id)
      : [...conversation.selectedAgentIds, agent.id];
    try {
      await window.grokky.updateConversation(conversation.id, { selectedAgentIds: next });
    } catch (error) {
      onError(error instanceof Error ? error.message : t("crew.updateFailed"));
    }
  }

  return (
    <div className="crew-picker" ref={pickerRef}>
      <button ref={triggerRef} className={`crew-picker-trigger ${selected.length ? "has-crew" : ""}`} type="button" aria-expanded={open} aria-haspopup="dialog" disabled={conversation.status === "running"} onClick={() => setOpen((value) => !value)}>
        <UsersThree size={14} />
        <span>{selected.length ? t("crew.count", { n: selected.length }) : t("crew.solo")}</span>
        <CaretDown size={12} />
      </button>
      {open && (
        <div className="crew-picker-popover" role="dialog" aria-label={t("crew.choose")}>
          <header><strong>{t("crew.choose")}</strong><small>{conversation.provider === "openrouter" ? t("crew.agnesHint") : t("crew.codexHint")}</small></header>
          {!enabled && <div className="crew-picker-warning"><WarningCircle size={15} />{t("crew.disabled")}</div>}
          <div className="crew-picker-list">
            {available.map((agent) => {
              const checked = conversation.selectedAgentIds.includes(agent.id);
              return (
                <button key={agent.id} data-agent-id={agent.id} type="button" className={checked ? "selected" : ""} disabled={!enabled} onClick={() => void toggle(agent)}>
                  <BotMascot mood={checked ? "working" : "idle"} identity={agent.name || agent.id} variant={agent.icon} size="xs" />
                  <span><strong>{agent.name}</strong><small>{tr(agent.description)}</small></span>
                  {checked ? <CheckCircle size={17} weight="fill" /> : <Plus size={15} />}
                </button>
              );
            })}
          </div>
          <button className="crew-create-link" type="button" onClick={() => { setOpen(false); onOpenAgents(); }}><UserPlus size={15} />{t("crew.createEdit")}</button>
        </div>
      )}
    </div>
  );
}

function projectName(pathname: string): string {
  return pathname.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) || pathname;
}

function ProjectPicker({ conversation, recentDirectories, attention, openRequest, onError }: {
  conversation: Conversation;
  recentDirectories: string[];
  attention: boolean;
  openRequest: number;
  onError(error: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const directories = [...new Set([
    ...(conversation.projectMode === "project" ? [conversation.workingDirectory] : []),
    ...recentDirectories,
  ])];
  const filtered = directories.filter((pathname) => projectName(pathname).toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    setOpen(false);
    setSearch("");
  }, [conversation.id]);

  useEffect(() => {
    if (!openRequest) return;
    setSearch("");
    setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerAway = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointerAway);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerAway);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function selectProject(pathname: string) {
    try {
      await window.grokky.updateConversation(conversation.id, { projectMode: "project", workingDirectory: pathname });
      setOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("project.selectFailed"));
    }
  }

  async function chooseProject() {
    try {
      const pathname = await window.grokky.chooseWorkingDirectory(conversation.id);
      if (pathname) setOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("project.selectFailed"));
    }
  }

  async function clearProject() {
    try {
      await window.grokky.updateConversation(conversation.id, { projectMode: "none" });
      setOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("project.clearFailed"));
    }
  }

  return (
    <div className="project-picker" ref={pickerRef}>
      <button ref={triggerRef} className={`project-picker-trigger ${conversation.projectMode === "project" ? "has-project" : ""} ${attention ? "needs-attention" : ""}`} type="button" aria-expanded={open} aria-haspopup="dialog" disabled={conversation.status === "running"} onClick={() => setOpen((value) => !value)}>
        <FolderOpen size={14} />
        <span>{conversation.projectMode === "project" ? projectName(conversation.workingDirectory) : t("project.choose")}</span>
        <CaretDown size={12} />
      </button>
      {open && (
        <div className="project-picker-popover" role="dialog" aria-label={t("project.chooseAria")}>
          <label className="project-search"><MagnifyingGlass size={15} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("project.search")} aria-label={t("project.search")} /></label>
          <div className="project-picker-list">
            {filtered.map((pathname) => {
              const selected = conversation.projectMode === "project" && pathname === conversation.workingDirectory;
              return (
                <button key={pathname} type="button" className={selected ? "selected" : ""} onClick={() => void selectProject(pathname)} title={pathname}>
                  <FolderOpen size={17} /><span><strong>{projectName(pathname)}</strong><small>{compactPath(pathname)}</small></span>{selected && <CheckCircle size={17} weight="fill" />}
                </button>
              );
            })}
            {!filtered.length && <p>{t("project.noMatch")}</p>}
          </div>
          <div className="project-picker-actions">
            <button type="button" onClick={() => void chooseProject()}><Plus size={16} />{t("project.chooseOrCreate")}</button>
            <button type="button" onClick={() => void clearProject()}><X size={16} />{t("project.none")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

type ComposerAccess = "read-only" | "workspace" | "full";

function AccessPicker({ conversation, attention, openRequest, onError }: { conversation: Conversation; attention: boolean; openRequest: number; onError(error: string): void }) {
  const value: ComposerAccess = conversation.sandboxMode === "read-only" ? "read-only" : conversation.allowCommands ? "full" : "workspace";
  const choices: Array<{ id: ComposerAccess; label: string; detail: string }> = [
    { id: "read-only", label: t("access.readOnly"), detail: t("access.readOnlyDetail") },
    { id: "workspace", label: t("access.workspace"), detail: t("access.workspaceDetail") },
    { id: "full", label: t("access.full"), detail: t("access.fullDetail") },
  ];
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [conversation.id]);
  useEffect(() => {
    if (openRequest) setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function select(next: ComposerAccess) {
    try {
      await window.grokky.updateConversation(conversation.id, {
        sandboxMode: next === "read-only" ? "read-only" : "workspace-write",
        allowCommands: next === "full",
      });
      setOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("access.updateFailed"));
    }
  }

  return (
    <div className="access-picker" ref={pickerRef}>
      <button className={`access-picker-trigger access-${value} ${attention ? "needs-attention" : ""}`} type="button" aria-expanded={open} disabled={conversation.status === "running"} onClick={() => setOpen((current) => !current)}>
        <ShieldCheck size={14} /><span>{choices.find((choice) => choice.id === value)?.label}</span><CaretDown size={12} />
      </button>
      {open && (
        <div className="access-picker-popover" role="menu" aria-label={t("access.chooseAria")}>
          {choices.map((choice) => (
            <button key={choice.id} type="button" className={choice.id === value ? "selected" : ""} onClick={() => void select(choice.id)}>
              <ShieldCheck size={17} /><span><strong>{choice.label}</strong><small>{choice.detail}</small></span>{choice.id === value && <CheckCircle size={17} weight="fill" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({ conversation, agents, recentDirectories, multiAgentEnabled, maxAgents, webSearchEnabled, onOpenAgents, onError }: {
  conversation: Conversation;
  agents: AgentDefinition[];
  recentDirectories: string[];
  multiAgentEnabled: boolean;
  maxAgents: number;
  webSearchEnabled: boolean;
  onOpenAgents(): void;
  onError(error: string): void;
}) {
  const [draft, setDraft] = useState("");
  const [preflightTarget, setPreflightTarget] = useState<"project" | "access" | null>(null);
  const [projectOpenRequest, setProjectOpenRequest] = useState(0);
  const [accessOpenRequest, setAccessOpenRequest] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const listener = (event: Event) => {
      setDraft((event as CustomEvent<string>).detail);
      requestAnimationFrame(() => textarea.current?.focus());
    };
    window.addEventListener("grokky:starter", listener);
    return () => window.removeEventListener("grokky:starter", listener);
  }, []);

  useEffect(() => {
    setDraft("");
    setPreflightTarget(null);
  }, [conversation.id]);

  useEffect(() => {
    if (preflightTarget === "project" && conversation.projectMode === "project") setPreflightTarget(null);
    if (preflightTarget === "access" && conversation.allowCommands) setPreflightTarget(null);
  }, [conversation.projectMode, conversation.allowCommands, preflightTarget]);

  async function submit() {
    const value = draft.trim();
    if (!value || conversation.status === "running") return;
    if (conversation.projectMode === "none" && requiresProjectDirectory(value)) {
      setPreflightTarget("project");
      setProjectOpenRequest((request) => request + 1);
      return;
    }
    if (requiresDevelopmentCommands(value) && !conversation.allowCommands) {
      setPreflightTarget("access");
      setAccessOpenRequest((request) => request + 1);
      return;
    }
    setPreflightTarget(null);
    setDraft("");
    try {
      await window.grokky.sendMessage(conversation.id, value);
    } catch (error) {
      setDraft(value);
      onError(error instanceof Error ? error.message : t("composer.sendFailed"));
    }
  }

  return (
    <div className="composer-wrap">
      {conversation.status === "running" && !conversation.selectedAgentIds.length && <BotMascot mood={conversationMood(conversation)} identity={`conversation:${conversation.id}`} size="sm" className="composer-bot" label={t("composer.workingLabel")} />}
      <div className={`composer ${conversation.status === "running" ? "is-running" : ""}`}>
        <textarea
          ref={textarea}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder={conversation.status === "running" ? t("composer.working") : t("composer.placeholder")}
          aria-label={t("composer.placeholder")}
          disabled={conversation.status === "running"}
        />
        {conversation.status === "running" ? (
          <button className="send-button stop-button" type="button" title={t("composer.stop")} onClick={() => void window.grokky.cancelRun(conversation.id)}>
            <Stop size={16} weight="fill" />
          </button>
        ) : (
          <button className="send-button" type="button" title={t("composer.send")} disabled={!draft.trim()} onClick={() => void submit()}>
            <PaperPlaneRight size={17} weight="fill" />
          </button>
        )}
      </div>
      <div className="composer-meta">
        <ProjectPicker conversation={conversation} recentDirectories={recentDirectories} attention={preflightTarget === "project"} openRequest={projectOpenRequest} onError={onError} />
        <AccessPicker conversation={conversation} attention={preflightTarget === "access"} openRequest={accessOpenRequest} onError={onError} />
        <CrewPicker conversation={conversation} agents={agents} enabled={multiAgentEnabled} maxAgents={maxAgents} onOpenAgents={onOpenAgents} onError={onError} />
        {preflightTarget && <span className="composer-preflight-note"><WarningCircle size={12} />{preflightTarget === "project" ? t("composer.needProject") : t("composer.needFull")}</span>}
        <span className={`web-access-status ${webSearchEnabled ? "enabled" : ""}`} title={webSearchEnabled ? t("composer.webOnTitle") : t("composer.webOffTitle")}><GlobeHemisphereWest size={12} />{webSearchEnabled ? t("composer.webOn") : t("composer.webOff")}</span>
        <span>{t("composer.enter")}</span>
      </div>
    </div>
  );
}

function Switch({ checked, disabled, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="switch-control">
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true"><i /></span>
    </label>
  );
}

function SignalPalette({ value, onChange }: { value: AccentPalette; onChange(value: AccentPalette): void }) {
  return (
    <fieldset className="signal-palette">
      <legend>{t("palette.signal")}</legend>
      <div className="signal-palette-grid">
        {SIGNAL_PALETTES.map((palette, index) => (
          <button
            key={palette.id}
            type="button"
            data-palette={palette.id}
            className={value === palette.id ? "selected" : ""}
            aria-pressed={value === palette.id}
            aria-label={`${tr(palette.label)}: ${tr(palette.detail)}`}
            onClick={() => onChange(palette.id)}
          >
            <span className="signal-swatch" aria-hidden="true"><i /><i /></span>
            <span className="signal-palette-copy"><small>{String(index + 1).padStart(2, "0")}</small><strong>{tr(palette.label)}</strong></span>
          </button>
        ))}
      </div>
      <p>{tr(SIGNAL_PALETTES.find((palette) => palette.id === value)?.detail ?? "")}</p>
    </fieldset>
  );
}

function scopeLabel(skill: SkillCapability): string {
  if (skill.scope === "project") return t("scope.project");
  if (skill.scope === "plugin") {
    const parts = skill.path.split("/");
    const cacheIndex = parts.lastIndexOf("cache");
    const version = cacheIndex >= 0 ? parts[cacheIndex + 3] : undefined;
    return version && /^\d/.test(version) ? t("scope.pluginVersion", { version }) : t("scope.plugin");
  }
  if (skill.scope === "system") return t("scope.system");
  return t("choice.personal");
}

function ComputerCapabilityIcon({ id }: { id: ComputerCapabilityId }) {
  if (id === "screen") return <Eye size={17} />;
  if (id === "automation") return <CursorClick size={17} />;
  if (id === "browser") return <GlobeHemisphereWest size={17} />;
  if (id === "commands") return <TerminalWindow size={17} />;
  return <FolderOpen size={17} />;
}

function permissionLabel(value: string): string {
  if (value === "not-required") return t("cmp.perm.none");
  if (value === "not-determined") return t("cmp.perm.notGranted");
  if (value === "unavailable") return t("cmp.perm.unavailable");
  return value === "granted" ? t("cmp.perm.granted") : t("cmp.perm.denied");
}

function SettingsDialog({ snapshot, conversation, agents, initialTab, onAgentsChange, onClose, onError }: {
  snapshot: AppSnapshot;
  conversation: Conversation;
  agents: AgentDefinition[];
  initialTab: SettingsTab;
  onAgentsChange(agents: AgentDefinition[]): void;
  onClose(): void;
  onError(error: string): void;
}) {
  const { language } = useStrings();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [capabilities, setCapabilities] = useState<CapabilitiesSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [computerBusy, setComputerBusy] = useState("");
  const [pairOpen, setPairOpen] = useState(false);
  const [runnerEndpoint, setRunnerEndpoint] = useState("http://127.0.0.1:4747");
  const [pairingCode, setPairingCode] = useState("");
  const [networkDomains, setNetworkDomains] = useState(snapshot.computerAccess.networkAllowlist.join("\n"));

  useEffect(() => {
    setTab(initialTab);
    void window.grokky.getCapabilities().then(setCapabilities).catch((error) => onError(error instanceof Error ? error.message : t("set.capLoadFailed")));
  }, [initialTab, onError]);

  useEffect(() => {
    setNetworkDomains(snapshot.computerAccess.networkAllowlist.join("\n"));
  }, [snapshot.computerAccess.networkAllowlist]);

  const filteredSkills = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return capabilities?.skills ?? [];
    return capabilities?.skills.filter((skill) => `${skill.name} ${skill.description} ${skill.scope}`.toLowerCase().includes(query)) ?? [];
  }, [capabilities?.skills, search]);

  async function patchConversation(value: Parameters<typeof window.grokky.updateConversation>[1]) {
    try {
      await window.grokky.updateConversation(conversation.id, value);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("set.sessionUpdateFailed"));
    }
  }

  async function patchSettings(value: Parameters<typeof window.grokky.updateSettings>[0]) {
    try {
      await window.grokky.updateSettings(value);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("set.settingsUpdateFailed"));
    }
  }

  async function toggleCapability(key: string, action: () => Promise<CapabilitiesSnapshot>) {
    setBusy(key);
    try {
      setCapabilities(await action());
    } catch (error) {
      onError(error instanceof Error ? error.message : t("set.capUpdateFailed"));
    } finally {
      setBusy("");
    }
  }

  async function computerAction(key: string, action: () => Promise<void>) {
    setComputerBusy(key);
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : t("cmp.updateFailed"));
    } finally {
      setComputerBusy("");
    }
  }

  async function pairRunner() {
    await computerAction("pair", async () => {
      await window.grokky.pairComputer(runnerEndpoint, pairingCode);
      setPairOpen(false);
      setPairingCode("");
    });
  }

  function beginAgentDraft(template: AgentDraft, editingId: string | null = null) {
    setEditingAgentId(editingId);
    setAgentDraft({ ...template, icon: template.icon ?? botVariantForIdentity(template.name || "default") });
  }

  function editAgent(agent: AgentDefinition) {
    beginAgentDraft({
      name: agent.name,
      description: agent.description,
      developerInstructions: agent.developerInstructions,
      scope: agent.scope === "project" ? "project" : "personal",
      icon: agent.icon ?? botVariantForIdentity(agent.name),
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.reasoning ? { reasoning: agent.reasoning } : {}),
      ...(agent.sandboxMode ? { sandboxMode: agent.sandboxMode } : {}),
    }, agent.builtIn ? null : agent.id);
  }

  async function saveAgent() {
    if (!agentDraft) return;
    setAgentBusy(true);
    try {
      const next = editingAgentId
        ? await window.grokky.updateAgent(editingAgentId, agentDraft)
        : await window.grokky.createAgent(agentDraft);
      onAgentsChange(next);
      setAgentDraft(null);
      setEditingAgentId(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("agt.saveFailed"));
    } finally {
      setAgentBusy(false);
    }
  }

  async function removeAgent() {
    if (!editingAgentId) return;
    const current = agents.find((agent) => agent.id === editingAgentId);
    if (!current || !window.confirm(t("agt.confirmDelete", { name: current.name }))) return;
    setAgentBusy(true);
    try {
      onAgentsChange(await window.grokky.deleteAgent(editingAgentId));
      setAgentDraft(null);
      setEditingAgentId(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("agt.deleteFailed"));
    } finally {
      setAgentBusy(false);
    }
  }

  const navItems: Array<{ id: SettingsTab; label: string; icon: typeof SlidersHorizontal }> = [
    { id: "session", label: t("set.tab.session"), icon: SlidersHorizontal },
    { id: "computer", label: t("set.tab.computer"), icon: DesktopTower },
    { id: "agents", label: t("set.tab.agents"), icon: UsersThree },
    { id: "skills", label: t("set.tab.skills"), icon: PuzzlePiece },
    { id: "mcp", label: t("set.tab.mcp"), icon: PlugsConnected },
    { id: "connectors", label: t("set.tab.connectors"), icon: Robot },
  ];
  const navGroups: Array<{ label: string; items: typeof navItems }> = [
    { label: t("set.group.workspace"), items: navItems.slice(0, 2) },
    { label: t("set.group.orchestration"), items: navItems.slice(2, 4) },
    { label: t("set.group.extensions"), items: navItems.slice(4, 6) },
  ];

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label={t("set.aria")}>
        <nav className="settings-nav" aria-label={t("set.sections")}>
          <div className="settings-brand"><BrandMark size="sm" /><strong>Grokky</strong></div>
          <div className="settings-nav-intro">
            <strong>{t("set.controlRoom")}</strong>
            <span>{t("set.shape")}</span>
          </div>
          <div className="settings-nav-groups">
            {navGroups.map((group) => (
              <div className="settings-nav-group" key={group.label}>
                <div className="settings-nav-group-label"><span>{group.label}</span><i /></div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const index = navItems.findIndex((candidate) => candidate.id === item.id) + 1;
                  return (
                    <button key={item.id} type="button" data-settings-view={item.id} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>
                      <span className="settings-nav-index">{String(index).padStart(2, "0")}</span>
                      <span className="settings-nav-icon"><Icon size={17} weight={tab === item.id ? "duotone" : "regular"} /></span>
                      <span className="settings-nav-copy">{item.label}</span>
                      <span className="settings-nav-marker" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <section className="settings-panel">
          <header className="settings-header">
            <h2>{navItems.find((item) => item.id === tab)?.label}</h2>
            <button className="icon-button" type="button" title={t("set.close")} onClick={onClose}><X size={18} /></button>
          </header>
          <div className="settings-body">
            {tab === "session" && (
              <div className="settings-stack">
                <div className="settings-intro"><h3>{t("set.group.workspace")}</h3><p>{t("set.workspaceIntro")}</p></div>
                <button className="settings-row path-setting" type="button" onClick={() => void window.grokky.chooseWorkingDirectory(conversation.id)}>
                  <span className="settings-row-icon"><FolderOpen size={18} /></span>
                  <span className="settings-copy"><strong>{t("set.workingDir")}</strong><small>{conversation.projectMode === "project" ? conversation.workingDirectory : t("hdr.noProject")}</small></span>
                  <ArrowUpRight size={15} />
                </button>
                <div className="settings-row path-setting">
                  <span className="settings-row-icon"><Monitor size={18} /></span>
                  <span className="settings-copy"><strong>{t("set.appearance")}</strong><small>{t("set.appearanceDetail")}</small></span>
                  <SelectMenu value={snapshot.settings.theme} choices={THEME_CHOICES} label={t("set.appearanceAria")} onChange={(theme) => void patchSettings({ theme })} />
                </div>
                <div className="settings-row path-setting">
                  <span className="settings-row-icon"><GlobeHemisphereWest size={18} /></span>
                  <span className="settings-copy"><strong>{t("set.language")}</strong><small>{t("set.languageDetail")}</small></span>
                  <SelectMenu value={language} choices={languageChoices()} label={t("set.languageAria")} onChange={(next) => setLanguage(next)} />
                </div>
                <SignalPalette value={snapshot.settings.accentPalette ?? "lime"} onChange={(accentPalette) => void patchSettings({ accentPalette })} />
                <div className="settings-row">
                  <span className="settings-copy"><strong>{t("set.wsPermission")}</strong><small>{t("set.wsPermissionDetail")}</small></span>
                  <SelectMenu value={conversation.sandboxMode} choices={SANDBOX_CHOICES} label={t("set.wsPermission")} disabled={conversation.status === "running"} onChange={(sandboxMode) => void patchConversation({ sandboxMode })} />
                </div>
                <div className={`settings-row ${conversation.sandboxMode === "read-only" ? "disabled" : ""}`}>
                  <span className="settings-copy"><strong>{t("set.devCommands")}</strong><small>{t("set.devCommandsDetail")}</small></span>
                  <Switch checked={conversation.allowCommands} disabled={conversation.sandboxMode === "read-only" || conversation.status === "running"} label={t("set.devCommands")} onChange={(checked) => void patchConversation({ allowCommands: checked })} />
                </div>
                <div className="settings-row web-search-setting">
                  <span className="settings-row-icon"><GlobeHemisphereWest size={18} /></span>
                  <span className="settings-copy"><strong>{t("set.webSearch")}</strong><small>{t("set.webSearchDetail")}</small></span>
                  <Switch checked={snapshot.settings.webSearchEnabled} disabled={conversation.status === "running"} label={t("set.webSearch")} onChange={(checked) => void patchSettings({ webSearchEnabled: checked })} />
                </div>
                <p className="settings-note">{t("set.webSearchNote")}</p>
                {conversation.provider === "openrouter" && (
                  <button className="settings-row path-setting" type="button" onClick={() => void window.grokky.chooseOpenRouterCredential()}>
                    <span className="settings-row-icon"><Robot size={18} /></span>
                    <span className="settings-copy"><strong>{t("set.openRouterCredential")}</strong><small>{snapshot.settings.openRouterCredentialPath || t("set.chooseEnv")}</small></span>
                    <ArrowUpRight size={15} />
                  </button>
                )}
                {conversation.usage && (
                  <div className="usage-summary">
                    <span><strong>{conversation.usage.inputTokens.toLocaleString()}</strong><small>{t("set.usage.input")}</small></span>
                    <span><strong>{conversation.usage.outputTokens.toLocaleString()}</strong><small>{t("set.usage.output")}</small></span>
                    <span><strong>{(conversation.usage.reasoningTokens ?? 0).toLocaleString()}</strong><small>{t("set.usage.reasoning")}</small></span>
                  </div>
                )}
              </div>
            )}

            {tab === "computer" && (
              <div className="settings-stack computer-access-stack">
                <div className="computer-hero">
                  <div className="computer-hero-bot"><BotMascot mood={snapshot.computerAccess.enabled ? "working" : "idle"} identity="computer-access" size="lg" /></div>
                  <div>
                    <span className="computer-kicker">{t("cmp.kicker")}</span>
                    <h3>{t("cmp.title")}</h3>
                    <p>{t("cmp.intro")}</p>
                  </div>
                  <Switch checked={snapshot.computerAccess.enabled} label={t("set.tab.computer")} onChange={(enabled) => void computerAction("enabled", () => window.grokky.setComputerAccessEnabled(enabled))} />
                </div>

                <section className="computer-section">
                  <div className="computer-section-heading"><div><h4>{t("cmp.connected")}</h4><p>{t("cmp.connectedDetail")}</p></div><button type="button" onClick={() => setPairOpen((open) => !open)}><WifiHigh size={14} />{t("cmp.pair")}</button></div>
                  <div className="device-list">
                    {snapshot.computerAccess.devices.map((device) => (
                      <div className="device-row-shell" key={device.id}>
                        <button
                          className={`device-row ${snapshot.computerAccess.activeDeviceId === device.id ? "selected" : ""}`}
                          type="button"
                          disabled={device.status === "revoked" || computerBusy === device.id}
                          onClick={() => void computerAction(device.id, () => window.grokky.selectComputer(device.id))}
                        >
                          <span className="device-icon">{device.kind === "local" ? <DesktopTower size={18} /> : <Monitor size={18} />}</span>
                          <span><strong>{device.name}</strong><small>{device.kind === "local" ? t("cmp.thisComputer") : device.endpoint} · {device.root}</small></span>
                          <em className={`device-status ${device.status}`}>{tr(device.status)}</em>
                          {snapshot.computerAccess.activeDeviceId === device.id && <ShieldCheck size={17} weight="fill" />}
                        </button>
                        {device.kind === "remote" && device.status !== "revoked" && <button className="device-revoke" type="button" title={t("cmp.revoke", { name: device.name })} aria-label={t("cmp.revoke", { name: device.name })} onClick={() => void computerAction(`revoke:${device.id}`, () => window.grokky.revokeComputer(device.id))}><Trash size={13} /></button>}
                      </div>
                    ))}
                  </div>
                  {pairOpen && (
                    <div className="pair-runner-form">
                      <div><strong>{t("cmp.pairAnother")}</strong><small>{t("cmp.pairDetail")}</small></div>
                      <label><span>{t("cmp.endpoint")}</span><input value={runnerEndpoint} onChange={(event) => setRunnerEndpoint(event.target.value)} placeholder="http://100.x.x.x:4747" /></label>
                      <label><span>{t("cmp.code")}</span><input value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="000000" /></label>
                      <div className="pair-runner-actions"><button type="button" onClick={() => setPairOpen(false)}>{t("cmp.cancel")}</button><button className="primary" type="button" disabled={computerBusy === "pair" || pairingCode.length !== 6 || !runnerEndpoint.trim()} onClick={() => void pairRunner()}>{computerBusy === "pair" ? <InlineLoader label={t("cmp.pairing")} /> : <ShieldCheck size={14} />}{t("cmp.pairSecurely")}</button></div>
                    </div>
                  )}
                </section>

                <section className={`computer-section ${!snapshot.computerAccess.enabled ? "disabled" : ""}`}>
                  <div className="computer-section-heading"><div><h4>{t("cmp.policy")}</h4><p>{t("cmp.policyDetail")}</p></div></div>
                  <div className="computer-capability-list">
                    {snapshot.computerAccess.capabilities.map((capability) => (
                      <div className={`computer-capability-row ${!capability.available ? "unavailable" : ""}`} key={capability.id}>
                        <span className="computer-capability-icon"><ComputerCapabilityIcon id={capability.id} /></span>
                        <span className="settings-copy"><strong>{tr(capability.label)}</strong><small>{tr(capability.description)}<b>{permissionLabel(capability.permission)}</b></small></span>
                        {(capability.id === "screen" || capability.id === "automation") && capability.permission !== "granted" && capability.available && (
                          <button className="permission-button" type="button" disabled={computerBusy === `permission:${capability.id}`} onClick={() => void computerAction(`permission:${capability.id}`, () => window.grokky.requestComputerPermission(capability.id))}>{t("cmp.systemAccess")}</button>
                        )}
                        <button className="computer-test" type="button" disabled={!snapshot.computerAccess.enabled || !capability.available || capability.level === "blocked" || Boolean(computerBusy)} onClick={() => void computerAction(`test:${capability.id}`, () => window.grokky.testComputerCapability(capability.id))}>{computerBusy === `test:${capability.id}` ? <InlineLoader label={t("cmp.testing", { label: tr(capability.label) })} quiet /> : t("cmp.test")}</button>
                        <SelectMenu value={capability.level} choices={COMPUTER_ACCESS_CHOICES} label={t("cmp.levelLabel", { label: tr(capability.label) })} disabled={!snapshot.computerAccess.enabled || !capability.available || Boolean(computerBusy)} onChange={(level) => void computerAction(`level:${capability.id}`, () => window.grokky.setComputerCapability(capability.id, level))} />
                      </div>
                    ))}
                  </div>
                </section>

                <section className={`computer-section network-section ${!snapshot.computerAccess.enabled ? "disabled" : ""}`}>
                  <div className="computer-section-heading"><div><h4>{t("cmp.allowlist")}</h4><p>{t("cmp.allowlistDetail")}</p></div><button type="button" disabled={computerBusy === "network"} onClick={() => void computerAction("network", () => window.grokky.updateComputerNetworkAllowlist(networkDomains.split(/\n|,/).map((domain) => domain.trim()).filter(Boolean)))}>{computerBusy === "network" ? <InlineLoader label={t("cmp.savingDomains")} quiet /> : <FloppyDisk size={13} />}{t("cmp.save")}</button></div>
                  <textarea value={networkDomains} onChange={(event) => setNetworkDomains(event.target.value)} placeholder={'github.com\ndevelopers.openai.com'} />
                </section>

                <section className="computer-section audit-section">
                  <div className="computer-section-heading"><div><h4>{t("cmp.recent")}</h4><p>{t("cmp.recentDetail")}</p></div><ClockCounterClockwise size={17} /></div>
                  <div className="computer-audit-list">
                    {snapshot.computerAccess.auditLog.slice(0, 12).map((entry) => (
                      <div className="computer-audit-row" key={entry.id}>
                        <span className={`${entry.decision} ${entry.status}`}><ComputerCapabilityIcon id={entry.capability} /></span>
                        <span><strong>{entry.action.replaceAll("_", " ")}</strong><small>{entry.target}</small></span>
                        <time>{timeLabel(entry.createdAt)}</time>
                      </div>
                    ))}
                    {!snapshot.computerAccess.auditLog.length && <div className="capability-empty">{t("cmp.noActions")}</div>}
                  </div>
                </section>
              </div>
            )}

            {tab === "skills" && (
              <div className="settings-stack capability-stack">
                <div className="settings-intro"><h3>{t("skl.title")}</h3><p>{t("skl.detail")}</p></div>
                <label className="capability-search"><MagnifyingGlass size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("skl.search")} /></label>
                {!capabilities ? <div className="capability-loading"><InlineLoader label={t("skl.loading")} /><span>{t("skl.loading")}</span></div> : (
                  <div className="capability-list">
                    {filteredSkills.map((skill) => (
                      <div className="capability-row" key={skill.id}>
                        <span className={`capability-kind-icon skill-kind-icon ${skill.enabled ? "enabled" : ""}`} aria-hidden="true"><PuzzlePiece size={17} weight={skill.enabled ? "fill" : "regular"} /></span>
                        <span className="settings-copy"><strong>{skill.name}<em>{scopeLabel(skill)}</em></strong><small>{skill.description}</small></span>
                        <Switch checked={skill.enabled} disabled={busy === skill.id} label={t("skl.label", { name: skill.name })} onChange={(enabled) => void toggleCapability(skill.id, () => window.grokky.setSkillEnabled(skill.path, enabled))} />
                      </div>
                    ))}
                    {!filteredSkills.length && <div className="capability-empty">{t("skl.none")}</div>}
                  </div>
                )}
                {capabilities && <p className="settings-note">{t("skl.active", { a: capabilities.skills.filter((skill) => skill.enabled).length, n: capabilities.skills.length })}</p>}
              </div>
            )}

            {tab === "agents" && (
              agentDraft ? (
                <div className="settings-stack agent-workbench">
                  <div className="agent-editor-header">
                    <button type="button" onClick={() => { setAgentDraft(null); setEditingAgentId(null); }}><ArrowLeft size={15} />{t("set.tab.agents")}</button>
                    <div><h3>{editingAgentId ? t("agt.edit", { name: agentDraft.name }) : t("agt.create")}</h3><p>{t("agt.formDetail")}</p></div>
                  </div>
                  <div className="agent-form">
                    <fieldset className="agent-icon-field">
                      <legend>{t("agt.botProfile")}</legend>
                      <div className="agent-icon-copy"><BotMascot mood="idle" variant={agentDraft.icon ?? "lime"} size="sm" label={t("agt.botProfileLabel", { name: tr(AGENT_ICONS.find((icon) => icon.id === (agentDraft.icon ?? "lime"))?.label ?? "Lime") })} /><span><strong>{t("agt.chooseBot")}</strong><small>{t("agt.botDetail")}</small></span></div>
                      <div className="agent-icon-picker" aria-label={t("agt.botChoices")}>
                        {AGENT_ICONS.map((icon) => (
                          <button key={icon.id} type="button" className={(agentDraft.icon ?? "lime") === icon.id ? "selected" : ""} aria-label={tr(icon.label)} aria-pressed={(agentDraft.icon ?? "lime") === icon.id} title={tr(icon.label)} onClick={() => setAgentDraft({ ...agentDraft, icon: icon.id })}>
                            <BotMascot mood="idle" variant={icon.id} size="xs" />
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <label className="agent-field"><span>{t("agt.name")}</span><input value={agentDraft.name} autoFocus onChange={(event) => setAgentDraft({ ...agentDraft, name: event.target.value })} placeholder="qa_scout" /></label>
                    <label className="agent-field"><span>{t("agt.description")}</span><input value={agentDraft.description} onChange={(event) => setAgentDraft({ ...agentDraft, description: event.target.value })} placeholder={t("agt.descriptionPlaceholder")} /></label>
                    <label className="agent-field agent-instructions"><span>{t("agt.instructions")}</span><textarea value={agentDraft.developerInstructions} onChange={(event) => setAgentDraft({ ...agentDraft, developerInstructions: event.target.value })} placeholder={t("agt.instructionsPlaceholder")} /></label>
                    <div className="agent-form-grid">
                      <div className="agent-field"><span>{t("agt.scope")}</span><SelectMenu value={agentDraft.scope} choices={AGENT_SCOPE_CHOICES} label={t("agt.scopeAria")} disabled={Boolean(editingAgentId)} onChange={(scope) => setAgentDraft({ ...agentDraft, scope })} /></div>
                      <div className="agent-field"><span>{t("agt.model")}</span><SelectMenu value={agentDraft.model ?? ""} choices={OPTIONAL_MODEL_CHOICES} label={t("agt.modelAria")} onChange={(model) => setAgentDraft({ ...agentDraft, model: model || undefined })} /></div>
                      <div className="agent-field"><span>{t("agt.reasoning")}</span><SelectMenu value={agentDraft.reasoning ?? ""} choices={OPTIONAL_REASONING_CHOICES} label={t("agt.reasoningAria")} onChange={(reasoning) => setAgentDraft({ ...agentDraft, reasoning: reasoning || undefined })} /></div>
                      <div className="agent-field"><span>{t("set.group.workspace")}</span><SelectMenu value={agentDraft.sandboxMode ?? ""} choices={OPTIONAL_SANDBOX_CHOICES} label={t("agt.workspaceAria")} onChange={(sandboxMode) => setAgentDraft({ ...agentDraft, sandboxMode: sandboxMode || undefined })} /></div>
                    </div>
                  </div>
                  <div className="agent-editor-actions">
                    {editingAgentId && <button className="agent-delete" type="button" disabled={agentBusy} onClick={() => void removeAgent()}><Trash size={14} />{t("agt.delete")}</button>}
                    <span />
                    <button type="button" disabled={agentBusy} onClick={() => { setAgentDraft(null); setEditingAgentId(null); }}>{t("cmp.cancel")}</button>
                    <button className="agent-save" type="button" disabled={agentBusy || !agentDraft.name.trim() || !agentDraft.description.trim() || !agentDraft.developerInstructions.trim()} onClick={() => void saveAgent()}>{agentBusy ? <InlineLoader label={t("agt.saving")} /> : <FloppyDisk size={14} />}{t("agt.save")}</button>
                  </div>
                </div>
              ) : (
                <div className="settings-stack agent-workbench">
                  <div className="capability-hero agent-hero"><BotMascot mood="working" identity="builder" size="lg" /><div><h3>{t("agt.heroTitle")}</h3><p>{t("agt.heroDetail")}</p><button type="button" onClick={() => beginAgentDraft({ name: "", description: "", developerInstructions: "", scope: "personal", icon: "lime" })}><UserPlus size={15} />{t("agt.new")}</button></div></div>
                  <div className="settings-row">
                    <span className="settings-copy"><strong>{t("agt.multi")}</strong><small>{t("agt.multiDetail")}</small></span>
                    <Switch checked={snapshot.settings.multiAgentEnabled} label={t("agt.multi")} onChange={(checked) => void patchSettings({ multiAgentEnabled: checked })} />
                  </div>
                  <div className={`settings-row ${!snapshot.settings.multiAgentEnabled ? "disabled" : ""}`}>
                    <span className="settings-copy"><strong>{t("agt.parallel")}</strong><small>{t("agt.parallelDetail")}</small></span>
                    <SelectMenu value={snapshot.settings.maxAgentThreads} choices={maxAgentChoices()} label={t("agt.parallelAria")} disabled={!snapshot.settings.multiAgentEnabled} onChange={(maxAgentThreads) => void patchSettings({ maxAgentThreads })} />
                  </div>
                  <div className="agent-form-grid agent-defaults">
                    <div className="agent-field"><span>{t("agt.defaultModel")}</span><SelectMenu value={snapshot.settings.defaultSubagentModel} choices={OPTIONAL_MODEL_CHOICES} label={t("agt.defaultModel")} disabled={!snapshot.settings.multiAgentEnabled} onChange={(defaultSubagentModel) => void patchSettings({ defaultSubagentModel })} /></div>
                    <div className="agent-field"><span>{t("agt.defaultReasoning")}</span><SelectMenu value={snapshot.settings.defaultSubagentReasoning} choices={OPTIONAL_REASONING_CHOICES} label={t("agt.defaultReasoningAria")} disabled={!snapshot.settings.multiAgentEnabled} onChange={(defaultSubagentReasoning) => void patchSettings({ defaultSubagentReasoning })} /></div>
                  </div>
                  <div className={`settings-row ${!snapshot.settings.multiAgentEnabled ? "disabled" : ""}`}>
                    <span className="settings-copy"><strong>{t("agt.updates")}</strong><small>{t("agt.updatesDetail")}</small></span>
                    <Switch checked={snapshot.settings.interruptAgentMessage} disabled={!snapshot.settings.multiAgentEnabled} label={t("agt.updates")} onChange={(checked) => void patchSettings({ interruptAgentMessage: checked })} />
                  </div>
                  <section className="agent-template-section">
                    <div className="agent-roster-header"><span><strong>{t("agt.quick")}</strong><small>{t("agt.quickDetail")}</small></span></div>
                    <div className="agent-template-strip">{AGENT_TEMPLATES.map((template) => <button key={template.label} type="button" onClick={() => beginAgentDraft(template)}><BotMascot mood="idle" identity={template.name} variant={template.icon} size="xs" /><span><strong>{tr(template.label)}</strong><small>{tr(template.description)}</small></span><Plus size={14} /></button>)}</div>
                  </section>
                  <section className="agent-roster">
                    <div className="agent-roster-header"><span><strong>{t("agt.yours")}</strong><small>{t("agt.available", { n: agents.length })}</small></span><button type="button" onClick={() => beginAgentDraft({ name: "", description: "", developerInstructions: "", scope: "personal", icon: "lime" })}><Plus size={14} />{t("agt.newShort")}</button></div>
                    <div className="agent-definition-list">
                      {agents.map((agent) => (
                        <button className="agent-definition-row" type="button" key={agent.id} onClick={() => editAgent(agent)}>
                          <BotMascot mood="idle" identity={agent.name || agent.id} variant={agent.icon} size="xs" />
                          <span className="settings-copy"><strong>{agent.name}<em>{tr(agent.scope)}</em></strong><small>{tr(agent.description)}</small></span>
                          {agent.builtIn ? <span className="agent-row-action"><Copy size={14} />{t("agt.duplicate")}</span> : <span className="agent-row-action">{t("agt.editShort")}<ArrowUpRight size={13} /></span>}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              )
            )}

            {tab === "mcp" && (
              <div className="settings-stack capability-stack">
                <div className="settings-intro"><h3>{t("mcp.title")}</h3><p>{t("mcp.detail")}</p></div>
                {!capabilities ? <div className="capability-loading"><InlineLoader label={t("mcp.loading")} /><span>{t("mcp.loading")}</span></div> : (
                  <div className="capability-list">
                    {capabilities.mcpServers.map((server) => (
                      <div className="capability-row" key={server.id}>
                        <span className="settings-row-icon"><PlugsConnected size={18} /></span>
                        <span className="settings-copy"><strong>{server.name}<em>{server.transport}</em></strong><small>{server.id}</small></span>
                        <Switch checked={server.enabled} disabled={busy === server.id} label={t("mcp.label", { name: server.name })} onChange={(enabled) => void toggleCapability(server.id, () => window.grokky.setMcpEnabled(server.id, enabled))} />
                      </div>
                    ))}
                    {!capabilities.mcpServers.length && <div className="capability-empty">{t("mcp.none")}</div>}
                  </div>
                )}
                <p className="settings-note">{t("mcp.note")}</p>
              </div>
            )}

            {tab === "connectors" && (
              <div className="settings-stack capability-stack">
                <div className="settings-intro"><h3>{t("con.title")}</h3><p>{t("con.detail")}</p></div>
                <div className="settings-row">
                  <span className="settings-copy"><strong>{t("con.runtime")}</strong><small>{t("con.runtimeDetail")}</small></span>
                  <Switch checked={snapshot.settings.connectorsEnabled} label={t("con.runtime")} onChange={(checked) => void patchSettings({ connectorsEnabled: checked })} />
                </div>
                {!capabilities ? <div className="capability-loading"><InlineLoader label={t("con.loading")} /><span>{t("con.loading")}</span></div> : (
                  <div className={`capability-list ${!snapshot.settings.connectorsEnabled ? "disabled" : ""}`}>
                    {capabilities.connectors.map((connector) => (
                      <div className="capability-row" key={connector.id}>
                        <span className="settings-row-icon"><Robot size={18} /></span>
                        <span className="settings-copy"><strong>{connector.name}</strong><small>{connector.id}</small></span>
                        <Switch checked={connector.enabled} disabled={!snapshot.settings.connectorsEnabled || busy === connector.id} label={t("con.label", { name: connector.name })} onChange={(enabled) => void toggleCapability(connector.id, () => window.grokky.setConnectorEnabled(connector.id, enabled))} />
                      </div>
                    ))}
                    {!capabilities.connectors.length && <div className="capability-empty">{t("con.none")}</div>}
                  </div>
                )}
                <p className="settings-note">{t("con.note")}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function DeleteConversationDialog({ title, busy, onCancel, onConfirm }: {
  title: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div className="delete-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.currentTarget === event.target) onCancel(); }}>
      <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-chat-title" aria-describedby="delete-chat-description">
        <div className="delete-dialog-icon"><Trash size={18} weight="fill" /></div>
        <div className="delete-dialog-copy">
          <span>{t("hdr.deleteChat")}</span>
          <h2 id="delete-chat-title">{t("del.title")}</h2>
          <p id="delete-chat-description"><strong>“{title}”</strong> {t("del.body")}</p>
        </div>
        <footer>
          <button ref={cancelRef} className="delete-cancel" type="button" disabled={busy} onClick={onCancel}>{t("cmp.cancel")}</button>
          <button className="delete-confirm" type="button" disabled={busy} onClick={onConfirm}><Trash size={14} weight="fill" />{busy ? t("del.deleting") : t("hdr.deleteChat")}</button>
        </footer>
      </section>
    </div>
  );
}

function ComputerApprovalDialog({ request, busy, onDecision }: {
  request: ComputerApprovalRequest;
  busy: boolean;
  onDecision(decision: ComputerApprovalDecision): void;
}) {
  const denyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    denyRef.current?.focus();
  }, [request.id]);

  return (
    <div className="computer-approval-backdrop">
      <section className="computer-approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="computer-approval-title" aria-describedby="computer-approval-description">
        <div className="computer-approval-bot"><BotMascot mood="thinking" identity={`approval:${request.capability}`} size="md" /></div>
        <div className="computer-approval-copy">
          <span>{t("apr.kicker")}</span>
          <h2 id="computer-approval-title">{t("apr.title", { name: request.deviceName })}</h2>
          <p id="computer-approval-description">{t("apr.prefix")} <strong>{request.action}</strong> {t("apr.for")} <code>{request.target}</code>.</p>
          <small>{t("apr.footer", { capability: request.capability })}</small>
        </div>
        <footer>
          <button ref={denyRef} type="button" disabled={busy} onClick={() => onDecision("deny")}>{t("apr.deny")}</button>
          <button type="button" disabled={busy} onClick={() => onDecision("allow-once")}>{t("apr.once")}</button>
          <button className="primary" type="button" disabled={busy} onClick={() => onDecision("allow-session")}>{busy ? <InlineLoader label={t("apr.applying")} /> : <ShieldCheck size={14} />}{t("apr.session")}</button>
        </footer>
      </section>
    </div>
  );
}

export function App() {
  useStrings();
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [uiError, setUiError] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [previewAvailable, setPreviewAvailable] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewReload, setPreviewReload] = useState(0);

  useEffect(() => {
    void window.grokky.getSnapshot().then(setSnapshot).catch((error) => setUiError(error.message));
    window.grokky.onSnapshot(setSnapshot);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    if (snapshot.settings.theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = snapshot.settings.theme;
    root.dataset.accent = snapshot.settings.accentPalette ?? "lime";
  }, [snapshot?.settings.theme, snapshot?.settings.accentPalette]);

  const activeWorkingDirectory = snapshot?.conversations.find((item) => item.id === snapshot.activeConversationId)?.workingDirectory
    ?? snapshot?.conversations[0]?.workingDirectory;

  useEffect(() => {
    if (!activeWorkingDirectory) return;
    void window.grokky.getAgents().then(setAgents).catch((error) => setUiError(error instanceof Error ? error.message : t("agt.loadFailed")));
  }, [snapshot?.activeConversationId, activeWorkingDirectory]);

  const active = snapshot?.conversations.find((item) => item.id === snapshot.activeConversationId) ?? snapshot?.conversations[0];
  const previewConversationId = active?.id;
  const previewStatus = active?.status;
  const previewDirectory = active?.workingDirectory;

  // Detection without polling: on opening a conversation and when a run ends.
  useEffect(() => {
    if (!previewConversationId || previewStatus === "running") return;
    let cancelled = false;
    void window.grokky.previewStatus(previewConversationId)
      .then((result) => { if (!cancelled) setPreviewAvailable(result.available); })
      .catch(() => { if (!cancelled) setPreviewAvailable(false); });
    return () => { cancelled = true; };
  }, [previewConversationId, previewStatus, previewDirectory]);

  // The preview server lives only while its panel is open for this conversation.
  useEffect(() => {
    setPreviewUrl(null);
    void window.grokky.previewStop().catch(() => undefined);
    return () => { void window.grokky.previewStop().catch(() => undefined); };
  }, [previewConversationId]);

  async function togglePreview() {
    if (!active) return;
    if (previewUrl) {
      setPreviewUrl(null);
      await window.grokky.previewStop().catch(() => undefined);
      return;
    }
    try {
      const result = await window.grokky.previewStart(active.id);
      setPreviewReload(0);
      setPreviewUrl(result.url);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : t("preview.failed"));
    }
  }
  const filtered = useMemo(() => snapshot?.conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())) ?? [], [snapshot?.conversations, search]);

  if (!snapshot || !active) {
    return <div className="loading-screen"><span className="loading-halo" /><BotMascot mood="thinking" size="lg" label={t("load.wakingLabel")} /><strong>{t("load.waking")}</strong><InlineLoader label={t("load.workspace")} /></div>;
  }

  async function updateProvider(provider: ProviderId) {
    try {
      await window.grokky.updateConversation(active!.id, { provider });
    } catch (error) {
      setUiError(error instanceof Error ? error.message : t("prov.changeFailed"));
    }
  }

  function requestDelete(conversation: Conversation) {
    if (conversation.status === "running") {
      setUiError(t("del.stopFirst"));
      return;
    }
    setPendingDelete({ id: conversation.id, title: conversation.title });
  }

  async function confirmDelete() {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await window.grokky.deleteConversation(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : t("del.failed"));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function resolveComputerApproval(request: ComputerApprovalRequest, decision: ComputerApprovalDecision) {
    if (approvalBusy) return;
    setApprovalBusy(true);
    try {
      await window.grokky.resolveComputerApproval(request.id, decision);
    } catch (error) {
      setUiError(error instanceof Error ? error.message : t("apr.failed"));
    } finally {
      setApprovalBusy(false);
    }
  }

  const activeStatus = snapshot.providerStatuses.find((status) => status.id === active.provider);
  const activeDevice = snapshot.computerAccess.devices.find((device) => device.id === snapshot.computerAccess.activeDeviceId);

  return (
    <div className="app-shell">
      <aside className="session-sidebar">
        <div className="window-drag" />
        <div className="brand-row">
          <BrandMark />
          <div><strong>Grokky</strong><span>{t("nav.localWorkspace")}</span></div>
          <button className="icon-button new-session" type="button" title={t("nav.newSession")} onClick={() => void window.grokky.createConversation()}><Plus size={18} /></button>
        </div>
        <label className="search-box">
          <MagnifyingGlass size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("nav.search")} aria-label={t("nav.searchSessions")} />
          {search && <button type="button" onClick={() => setSearch("")}><X size={13} /></button>}
        </label>
        <nav className="session-list" data-label={t("nav.recentRuns")} aria-label={t("nav.conversations")}>
          {filtered.map((conversation) => (
            <div className="session-entry" key={conversation.id}>
              <button className={`session-item ${conversation.id === active.id ? "active" : ""}`} type="button" onClick={() => void window.grokky.setActiveConversation(conversation.id)}>
                <BotMascot mood={conversationMood(conversation)} identity={`conversation:${conversation.id}`} size="xs" />
                <span><strong>{tr(conversation.title)}</strong><small>{providerName(conversation.provider)}<i />{timeLabel(conversation.updatedAt)}</small></span>
                {conversation.status === "running" && <InlineLoader label={t("nav.sessionRunning", { title: tr(conversation.title) })} quiet />}
              </button>
              {conversation.status !== "running" && conversation.id === active.id && (
                <button
                  className="session-delete"
                  type="button"
                  title={t("nav.deleteTitle", { title: tr(conversation.title) })}
                  aria-label={t("nav.deleteTitle", { title: tr(conversation.title) })}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDelete(conversation);
                  }}
                >
                  <Trash size={15} weight="duotone" />
                </button>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" data-settings-tab="agents" onClick={() => setSettingsTab("agents")}><UsersThree size={17} />{t("nav.crew")}</button>
          <button type="button" data-settings-tab="computer" onClick={() => setSettingsTab("computer")}><DesktopTower size={17} />{t("nav.computer")}</button>
          <button type="button" data-settings-tab="skills" onClick={() => setSettingsTab("skills")}><PuzzlePiece size={17} />{t("nav.skillsTools")}</button>
          <button type="button" data-settings-tab="session" onClick={() => setSettingsTab("session")}><GearSix size={17} />{t("nav.settings")}</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-toolbar">
          <div className="toolbar-drag" />
          <div className="chat-identity">
            <BotMascot mood={conversationMood(active)} identity={`conversation:${active.id}`} size="xs" />
            <span><strong>{tr(active.title)}</strong><small>{active.projectMode === "project" ? compactPath(active.workingDirectory) : t("hdr.noProject")}</small></span>
          </div>
          <div className="toolbar-controls">
            <div className="toolbar-rail" aria-label={t("hdr.runConfig")}>
              <div className="provider-switch" aria-label={t("hdr.provider")}>
                <button type="button" aria-pressed={active.provider === "codex"} className={active.provider === "codex" ? "active" : ""} onClick={() => void updateProvider("codex")}><span aria-hidden="true" />Codex</button>
                <button type="button" aria-pressed={active.provider === "openrouter"} className={active.provider === "openrouter" ? "active" : ""} onClick={() => void updateProvider("openrouter")}><span aria-hidden="true" />OpenRouter</button>
              </div>
              <i className="toolbar-separator" aria-hidden="true" />
              <div className="toolbar-field model-field">
                <Robot size={15} weight="duotone" />
                {active.provider === "codex" ? (
                  <SelectMenu value={active.model} choices={CODEX_MODEL_CHOICES} label={t("hdr.codexModel")} compact disabled={active.status === "running"} onChange={(model) => void window.grokky.updateConversation(active.id, { model }).catch((error) => setUiError(error.message))} />
                ) : (
                  <ModelCombobox value={active.model} suggestions={OPENROUTER_SUGGESTIONS} label={t("hdr.openRouterModel")} disabled={active.status === "running"} onCommit={(model) => void window.grokky.updateConversation(active.id, { model }).catch((error) => setUiError(error.message))} />
                )}
              </div>
              <i className="toolbar-separator" aria-hidden="true" />
              <div className="toolbar-field reasoning-field">
                <Brain size={15} weight="duotone" />
                <SelectMenu value={active.reasoning} choices={REASONING_CHOICES} label={t("hdr.reasoningEffort")} compact disabled={active.status === "running"} onChange={(reasoning) => void window.grokky.updateConversation(active.id, { reasoning }).catch((error) => setUiError(error.message))} />
              </div>
            </div>
            <div className="toolbar-actions" aria-label={t("hdr.sessionActions")}>
              {(previewAvailable || previewUrl) && <button className={`preview-button ${previewUrl ? "open" : ""}`} type="button" aria-pressed={Boolean(previewUrl)} data-tooltip={t("preview.title")} aria-label={t("preview.title")} onClick={() => void togglePreview()}><Eye size={16} weight="duotone" /><span>{t("preview.button")}</span></button>}
              <button className={`icon-button computer-toolbar ${snapshot.computerAccess.enabled && activeDevice?.status === "online" ? "connected" : ""}`} data-tooltip={snapshot.computerAccess.enabled ? t("hdr.computerName", { name: activeDevice?.name || t("hdr.unavailable") }) : t("hdr.computerOff")} aria-label={snapshot.computerAccess.enabled ? t("hdr.computerName", { name: activeDevice?.name || t("hdr.unavailable") }) : t("hdr.computerOff")} type="button" onClick={() => setSettingsTab("computer")}><DesktopTower size={17} weight="duotone" /></button>
              {!activeStatus?.ready && <button className="icon-button setup-warning" data-tooltip={tr(activeStatus?.detail ?? "") || t("hdr.providerNeedsSetup")} aria-label={tr(activeStatus?.detail ?? "") || t("hdr.providerNeedsSetup")} type="button" onClick={() => setSettingsTab("session")}><WarningCircle size={17} /></button>}
              <button className="icon-button" data-tooltip={t("hdr.sessionSettings")} aria-label={t("hdr.sessionSettings")} type="button" onClick={() => setSettingsTab("session")}><GearSix size={17} /></button>
              <button className="icon-button danger" data-tooltip={active.status === "running" ? t("hdr.stopBeforeDelete") : t("hdr.deleteChat")} aria-label={active.status === "running" ? t("hdr.stopBeforeDelete") : t("hdr.deleteChat")} type="button" onClick={() => requestDelete(active)} disabled={active.status === "running"}><Trash size={16} /></button>
            </div>
          </div>
        </header>

        <div className={`workspace-body ${previewUrl ? "with-preview" : ""}`}>
          <MessageList conversation={active} agents={agents} />
          {previewUrl && (
            <section className="preview-panel" aria-label={t("preview.title")}>
              <header className="preview-panel-bar">
                <strong>{t("preview.title")}</strong>
                <button className="icon-button" type="button" data-tooltip={t("preview.reload")} aria-label={t("preview.reload")} onClick={() => setPreviewReload((value) => value + 1)}><ArrowClockwise size={16} /></button>
                <button className="icon-button" type="button" data-tooltip={t("preview.close")} aria-label={t("preview.close")} onClick={() => void togglePreview()}><X size={16} /></button>
              </header>
              <iframe key={previewReload} className="preview-frame" src={previewUrl} title={t("preview.title")} sandbox="allow-scripts" />
            </section>
          )}
        </div>        <Composer conversation={active} agents={agents} recentDirectories={snapshot.settings.recentWorkingDirectories} multiAgentEnabled={snapshot.settings.multiAgentEnabled} maxAgents={snapshot.settings.maxAgentThreads} webSearchEnabled={snapshot.settings.webSearchEnabled} onOpenAgents={() => setSettingsTab("agents")} onError={setUiError} />
      </main>

      {settingsTab && <SettingsDialog snapshot={snapshot} conversation={active} agents={agents} initialTab={settingsTab} onAgentsChange={setAgents} onClose={() => setSettingsTab(null)} onError={setUiError} />}

      {pendingDelete && <DeleteConversationDialog title={pendingDelete.title} busy={deleteBusy} onCancel={() => { if (!deleteBusy) setPendingDelete(null); }} onConfirm={() => void confirmDelete()} />}

      {snapshot.computerAccess.pendingApproval && <ComputerApprovalDialog request={snapshot.computerAccess.pendingApproval} busy={approvalBusy} onDecision={(decision) => void resolveComputerApproval(snapshot.computerAccess.pendingApproval!, decision)} />}

      {uiError && <div className="toast" role="alert"><WarningCircle size={17} /><span>{uiError}</span><button type="button" onClick={() => setUiError("")}><X size={14} /></button></div>}
    </div>
  );
}
