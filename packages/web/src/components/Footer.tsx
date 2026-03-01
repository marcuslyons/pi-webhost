import { useChatStore } from "../stores/chatStore";
import type { ContextUsage, SessionStats } from "../lib/types";

export function Footer() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessionStatsMap = useChatStore((s) => s.sessionStatsMap);

  if (!activeSessionId) return null;

  const data = sessionStatsMap.get(activeSessionId);
  if (!data) return null;

  const { stats, context } = data;

  return (
    <div className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-900 px-4 py-1.5 text-[11px] font-mono text-zinc-500">
      <TokenStats stats={stats} />
      <span className="text-zinc-700">·</span>
      <CostDisplay cost={stats.cost} />
      {context && <ContextBar context={context} />}
    </div>
  );
}

function TokenStats({ stats }: { stats: SessionStats }) {
  const { tokens } = stats;
  return (
    <div className="flex items-center gap-2">
      <span title="Input tokens">
        <span className="text-zinc-600">↑</span>{abbreviate(tokens.input)}
      </span>
      <span title="Output tokens">
        <span className="text-zinc-600">↓</span>{abbreviate(tokens.output)}
      </span>
      {tokens.cacheRead > 0 && (
        <span title="Cache read tokens">
          <span className="text-zinc-600">R</span>{abbreviate(tokens.cacheRead)}
        </span>
      )}
      {tokens.cacheWrite > 0 && (
        <span title="Cache write tokens">
          <span className="text-zinc-600">W</span>{abbreviate(tokens.cacheWrite)}
        </span>
      )}
    </div>
  );
}

function CostDisplay({ cost }: { cost: number }) {
  const formatted = cost < 0.01 && cost > 0
    ? `$${cost.toFixed(4)}`
    : `$${cost.toFixed(2)}`;

  return (
    <span title="Session cost" className="text-zinc-400">
      {formatted}
    </span>
  );
}

function ContextBar({ context }: { context: ContextUsage }) {
  if (context.percent == null) return null;

  const pct = Math.min(context.percent, 100);
  const barColor =
    pct > 80 ? "bg-red-500" :
    pct > 60 ? "bg-amber-500" :
    "bg-emerald-500";

  return (
    <>
      <span className="text-zinc-700">·</span>
      <div className="flex items-center gap-1.5" title={`${context.tokens?.toLocaleString() ?? "?"} / ${context.contextWindow.toLocaleString()} tokens`}>
        <div className="h-1.5 w-16 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span>
          {Math.round(pct)}% of {abbreviate(context.contextWindow)}
        </span>
      </div>
    </>
  );
}

function abbreviate(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
