import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { ReadingSection } from "./ReadingSection";

type SettingsTab = "appearance" | "reading" | "about";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
};

/** 设置弹窗：书架与阅读页共用，点遮罩、Esc 或右上角 × 关闭。 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("appearance");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            外观、阅读偏好与本地数据，全部保存在本机。
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-auto px-1">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as SettingsTab)}
            className="flex flex-col"
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
      </DialogContent>
    </Dialog>
  );
}
