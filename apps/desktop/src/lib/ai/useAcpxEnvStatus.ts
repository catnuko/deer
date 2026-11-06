import { useCallback, useEffect, useState } from "react";
import { acpxEnvCheck, type AcpxEnvStatus } from "@/lib/ai/claudeBackend";

/** 自检失败也返回可读状态，绝不把调用方打挂。 */
async function readAcpxEnvStatus(): Promise<AcpxEnvStatus> {
  try {
    return await acpxEnvCheck();
  } catch (error) {
    return {
      ok: false,
      nodeOk: false,
      nodeVersion: null,
      acpxVersion: null,
      message: `acpx 环境检查失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * acpx 环境自检（聊天面板与设置页共用）：进入时查一次，可手动重新检测。
 * 首次检查在 Promise 回调里落状态，避免 effect 内同步 setState。
 */
export function useAcpxEnvStatus(enabled: boolean) {
  const [status, setStatus] = useState<AcpxEnvStatus | null>(null);
  // 首次进入即处于「检测中」，与检查的启动方式保持一致。
  const [checking, setChecking] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    readAcpxEnvStatus().then((next) => {
      if (!alive) return;
      setStatus(next);
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setChecking(true);
    setStatus(await readAcpxEnvStatus());
    setChecking(false);
  }, [enabled]);

  return { status, checking, refresh };
}