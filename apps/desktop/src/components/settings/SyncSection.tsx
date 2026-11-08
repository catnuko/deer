import { useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { SettingRow } from "@/components/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  startSyncRuntime,
  stopSyncRuntime,
  syncNow,
  testWebDavConnection,
} from "@/lib/sync/runtime";
import { useSyncStore } from "@/lib/sync/statusStore";
import type { SyncPhase } from "@/lib/sync/types";
import { isTauri } from "@/lib/platform";
import { useAppSettings } from "@/store/appSettings";

const PHASE_LABELS: Record<SyncPhase, string> = {
  off: "未开启",
  idle: "空闲",
  syncing: "同步中",
  error: "出错",
};

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

/** 同步组：WebDAV 配置、连接测试、手动同步与同步状态。 */
export function SyncSection() {
  const desktop = isTauri();
  const syncEnabled = useAppSettings((s) => s.syncEnabled);
  const syncBooks = useAppSettings((s) => s.syncBooks);
  const setSyncEnabled = useAppSettings((s) => s.setSyncEnabled);
  const setSyncUrl = useAppSettings((s) => s.setSyncUrl);
  const setSyncUsername = useAppSettings((s) => s.setSyncUsername);
  const setSyncPassword = useAppSettings((s) => s.setSyncPassword);
  const setSyncBooks = useAppSettings((s) => s.setSyncBooks);

  const phase = useSyncStore((s) => s.phase);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastError = useSyncStore((s) => s.lastError);
  const lastReport = useSyncStore((s) => s.lastReport);
  const filesSynced = useSyncStore((s) => s.filesSynced);

  // 表单值先落在本地 state，失焦或点「保存」才写进 appSettings 并重启运行时。
  const [url, setUrl] = useState(() => useAppSettings.getState().syncUrl);
  const [username, setUsername] = useState(
    () => useAppSettings.getState().syncUsername,
  );
  const [password, setPassword] = useState(
    () => useAppSettings.getState().syncPassword,
  );
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  async function handleToggle(checked: boolean) {
    setSyncEnabled(checked);
    if (checked) {
      await startSyncRuntime();
    } else {
      stopSyncRuntime();
    }
  }

  /** 提交表单到 appSettings；同步已开启时重启运行时让新配置生效。 */
  function commitConfig() {
    const nextUrl = url.trim();
    const nextUsername = username.trim();
    if (
      nextUrl === useAppSettings.getState().syncUrl &&
      nextUsername === useAppSettings.getState().syncUsername &&
      password === useAppSettings.getState().syncPassword
    ) {
      return;
    }
    setSyncUrl(nextUrl);
    setSyncUsername(nextUsername);
    setSyncPassword(password);
    if (useAppSettings.getState().syncEnabled) {
      void startSyncRuntime();
    }
  }

  async function runTest() {
    setTest({ kind: "testing" });
    const result = await testWebDavConnection({
      url: url.trim(),
      username: username.trim(),
      password,
    });
    setTest(
      result.ok
        ? { kind: "ok", message: result.message }
        : { kind: "error", message: result.message },
    );
  }

  if (!desktop) {
    return (
      <div className="max-w-xl space-y-2">
        <SettingRow
          title="同步"
          description="同步只在桌面应用里可用。"
          className="items-start"
        >
          <Switch checked={false} onCheckedChange={() => {}} disabled aria-label="开启同步" />
        </SettingRow>
        <div className="border-border bg-muted/30 -mt-1 rounded-lg border px-3 py-2">
          <p className="text-muted-foreground text-xs leading-relaxed">
            浏览器预览模式不支持 WebDAV 同步，请使用桌面应用。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-2">
      <SettingRow
        title="同步"
        description="把书籍进度、标注与笔记通过 WebDAV 网盘在多台设备间同步。"
      >
        <Switch
          checked={syncEnabled}
          onCheckedChange={(checked) => void handleToggle(checked)}
          aria-label="开启同步"
        />
      </SettingRow>

      {syncEnabled && !url.trim() ? (
        <p className="text-destructive text-xs leading-relaxed">
          已开启同步，但还没有填写 WebDAV 地址，填好后才会开始同步。
        </p>
      ) : null}

      <Separator />

      <div className="py-2">
        <p className="text-sm font-medium">WebDAV 配置</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          在你的网盘（如坚果云）里建一个同步目录，把地址、账号和应用密码填到这里。
        </p>
      </div>

      <SettingRow
        title="服务器地址"
        description="WebDAV 根目录的完整 URL。"
      >
        <Input
          aria-label="WebDAV 服务器地址"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onBlur={commitConfig}
          placeholder="https://dav.jianguoyun.com/dav/deer-sync"
          className="w-72"
          spellCheck={false}
        />
      </SettingRow>

      <SettingRow title="账号" description="网盘登录账号，坚果云填邮箱。">
        <Input
          aria-label="WebDAV 账号"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          onBlur={commitConfig}
          placeholder="you@example.com"
          className="w-72"
          spellCheck={false}
          autoComplete="off"
        />
      </SettingRow>

      <SettingRow
        title="应用密码"
        description="网盘生成的应用密码，不是登录密码；仅存本机。"
      >
        <Input
          aria-label="WebDAV 应用密码"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={commitConfig}
          placeholder="应用密码"
          className="w-72"
          autoComplete="off"
        />
      </SettingRow>

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0" aria-live="polite">
          {test.kind === "idle" ? null : test.kind === "testing" ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <LoaderCircle className="size-3.5 animate-spin" />
              测试中…
            </p>
          ) : test.kind === "ok" ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5 shrink-0" />
              {test.message}
            </p>
          ) : (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <X className="size-3.5 shrink-0" />
              {test.message}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={test.kind === "testing"}
            onClick={() => void runTest()}
          >
            测试连接
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={phase === "syncing"}
            onClick={() => void syncNow()}
          >
            立即同步
          </Button>
          <Button variant="outline" size="sm" onClick={commitConfig}>
            保存
          </Button>
        </div>
      </div>

      <Separator />

      <div className="py-2">
        <p className="text-sm font-medium">同步状态</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {PHASE_LABELS[phase]}
          {lastSyncedAt
            ? ` · 上次同步 ${new Date(lastSyncedAt).toLocaleString("zh-CN")}`
            : ""}
          {lastReport
            ? ` · 推送 ${lastReport.pushed} 条 / 拉取 ${lastReport.pulled} 块 / 应用 ${lastReport.applied} 条`
            : ""}
          {filesSynced > 0 ? ` · 已上传 ${filesSynced} 个书籍文件` : ""}
        </p>
        {lastError ? (
          <p className="text-destructive mt-1 text-xs leading-relaxed">
            {lastError}
          </p>
        ) : null}
      </div>

      <Separator />

      <SettingRow
        title="同步书籍文件"
        description="书籍本体与封面也上传到网盘；关闭则只同步元数据、笔记与进度。"
      >
        <Switch
          checked={syncBooks}
          onCheckedChange={(checked) => {
            setSyncBooks(checked);
          }}
          aria-label="同步书籍文件"
        />
      </SettingRow>

      <div className="border-border bg-muted/30 rounded-lg border px-3 py-2">
        <p className="text-muted-foreground text-xs leading-relaxed">
          同步数据以明文 JSON 存在你自己的 WebDAV 目录里，请确保该目录私有。
        </p>
      </div>
    </div>
  );
}
