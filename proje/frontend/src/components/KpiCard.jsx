import { fmtTRY } from "@/lib/format";

const toneMap = {
  green: "text-[hsl(144_100%_50%)] glow-green",
  red: "text-[hsl(345_100%_65%)] glow-red",
  yellow: "text-[hsl(53_98%_60%)] glow-yellow",
  cyan: "text-[hsl(186_100%_60%)]",
  white: "text-white",
};

export default function KpiCard({ label, value, tone = "white", icon: Icon, hint, testId, currency = true }) {
  const cls = toneMap[tone] || toneMap.white;
  return (
    <div
      data-testid={testId}
      className="relative border border-border bg-card p-5 rounded-sm hover:border-neutral-600 transition-colors duration-200 overflow-hidden"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</div>
        {Icon && <Icon className="w-4 h-4 text-neutral-500" strokeWidth={2} />}
      </div>
      <div className={`font-data text-3xl font-light tracking-tight ${cls}`}>
        {currency ? fmtTRY(value) : value}
      </div>
      {hint && <div className="mt-2 text-[11px] text-neutral-500 font-data">{hint}</div>}
    </div>
  );
}
