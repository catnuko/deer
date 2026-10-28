import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AboutSection } from "@/components/settings/AboutSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { ReadingSection } from "@/components/settings/ReadingSection";

const TABS = ["appearance", "reading", "about"] as const;
type SettingsTab = (typeof TABS)[number];

export function SettingsPage() {
  // 支持 ?tab=reading 这样的直达链接；之后切换走本地状态。
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<SettingsTab>(
    TABS.includes(initialTab as SettingsTab)
      ? (initialTab as SettingsTab)
      : "appearance",
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="设置"
        description="外观、阅读偏好与本地数据，全部保存在本机。"
      />

      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as SettingsTab)}
          className="flex max-w-2xl flex-col"
        >
          <TabsList variant="line">
            <TabsTrigger value="appearance">外观</TabsTrigger>
            <TabsTrigger value="reading">阅读</TabsTrigger>
            <TabsTrigger value="about">关于</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="pt-4">
            <AppearanceSection />
          </TabsContent>
          <TabsContent value="reading" className="pt-4">
            <ReadingSection />
          </TabsContent>
          <TabsContent value="about" className="pt-4">
            <AboutSection />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
