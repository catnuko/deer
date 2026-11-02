export type DiagnosticsInput = {
  appVersion: string;
  /** 桌面端为 "Tauri"，浏览器预览为 "浏览器预览"。 */
  runtime: string;
  userAgent: string;
  nodeVersion?: string | null;
  acpxVersion?: string | null;
  acpxReady?: boolean | null;
  dataDir?: string | null;
  /** 注入固定时间，便于单测。 */
  copiedAt: Date;
};

function acpxLine(
  version: string | null | undefined,
  ready: boolean | null | undefined,
): string {
  if (!version) return "未检测到";
  if (ready === true) return `${version}（就绪）`;
  if (ready === false) return `${version}（未就绪）`;
  return version;
}

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

/** 「复制诊断信息」的纯格式化层：不读取真实环境，字段全部由调用方注入。 */
export function buildDiagnostics(input: DiagnosticsInput): string {
  return [
    "Deer 诊断信息",
    `版本：${input.appVersion || "unknown"}`,
    `运行环境：${input.runtime}`,
    `WebView：${input.userAgent || "unknown"}`,
    `Node：${input.nodeVersion || "未检测到"}`,
    `acpx：${acpxLine(input.acpxVersion, input.acpxReady)}`,
    `数据目录：${input.dataDir || "不可用"}`,
    `复制时间：${stamp(input.copiedAt)}`,
  ].join("\n");
}