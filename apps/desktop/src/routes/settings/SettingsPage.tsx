import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AboutSection } from "@/components/settings/AboutSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { ReadingSection } from "@/components/settings/ReadingSection";

export function SettingsPage() {
  const [tab, setTab] = useState("appearance");

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="设置"
        description="外观、阅读偏好与本地数据，全部保存在本机。"
      />

      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="max-w-2xl"
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
