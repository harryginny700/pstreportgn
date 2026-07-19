import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Settings2, DollarSign, Bot } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AdminSettingsUsdRate from "./AdminSettingsUsdRate";
import AdminBot from "./AdminBot";

const TABS = [
  { key: "usd", label: "USD / TRY Kuru", icon: DollarSign },
  { key: "bot", label: "Telegram Botu", icon: Bot },
];

export default function AdminSettings() {
  const [params, setParams] = useSearchParams();
  const initial = useMemo(() => {
    const p = params.get("tab");
    return TABS.some((t) => t.key === p) ? p : "usd";
  }, [params]);
  const [tab, setTab] = useState(initial);

  const onChange = (v) => {
    setTab(v);
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="admin-settings-page">
      <div className="flex items-center gap-3">
        <Settings2 className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Admin</div>
          <h2 className="font-display text-xl text-foreground">Ayarlar</h2>
        </div>
      </div>

      <Tabs value={tab} onValueChange={onChange} className="w-full">
        <TabsList className="bg-card border border-border rounded-sm h-auto p-1 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              data-testid={`settings-tab-${t.key}`}
              className="rounded-sm data-[state=active]:bg-secondary data-[state=active]:text-foreground text-muted-foreground gap-2 px-3 h-8 text-xs"
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="usd" className="mt-6">
          <AdminSettingsUsdRate />
        </TabsContent>
        <TabsContent value="bot" className="mt-6">
          <AdminBot />
        </TabsContent>
      </Tabs>
    </div>
  );
}
