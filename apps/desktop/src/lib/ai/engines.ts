/**
 * AI 伴读引擎目录（acpx 内置 27 个 agent，数据取自 acpx@0.21.1 内置注册表，
 * 不在本地维护第二份版本线）：
 * - 常用 7 个固定前排，其余 20 个由「显示其余引擎」展开。
 * - installMode：
 *   - adapter：acpx 官方 npm 适配器包，可一键安装（Rust 侧白名单校验后
 *     `npm install -g <pkg>@<range>`）。
 *   - npx：acpx 用 npx 现取，本机无需预装即可跑（状态显示「可直接用」）。
 *   - vendor：厂商 CLI 自带 ACP 模式，只展示官方安装方式，绝不代跑、不编命令。
 */

export type AiEngineInstallMode = "adapter" | "npx" | "vendor";

export type AiEngineSpec = {
  /** acpx agent id，即 acpx_chat 的 engine 参数与会话名组成段。 */
  id: string;
  name: string;
  /** 本机可执行名，探测「已安装」用。 */
  bin: string;
  installMode: AiEngineInstallMode;
  /** adapter 模式的 npm 包名与 acpx 锁定的版本线。 */
  adapterPackage?: string;
  adapterRange?: string;
  /** vendor 模式的官方安装提示（只展示）。 */
  installHint?: string;
  common: boolean;
};

export const AI_ENGINES: AiEngineSpec[] = [
  // ---- 常用 7 ----
  {
    id: "claude",
    name: "Claude Code",
    bin: "claude",
    installMode: "adapter",
    adapterPackage: "@agentclientprotocol/claude-agent-acp",
    adapterRange: "^0.95.0",
    common: true,
  },
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    installMode: "adapter",
    adapterPackage: "@agentclientprotocol/codex-acp",
    adapterRange: "^1.1.5",
    common: true,
  },
  {
    id: "kimi",
    name: "Kimi Code",
    bin: "kimi",
    installMode: "vendor",
    installHint: "请通过 Moonshot 官方渠道安装 Kimi CLI（kimi）。",
    common: true,
  },
  {
    id: "qwen",
    name: "Qwen Code",
    bin: "qwen",
    installMode: "vendor",
    installHint: "npm install -g @qwen-code/qwen-code",
    common: true,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    bin: "gemini",
    installMode: "vendor",
    installHint: "npm install -g @google/gemini-cli",
    common: true,
  },
  {
    id: "cursor",
    name: "Cursor",
    bin: "cursor-agent",
    installMode: "vendor",
    installHint: "按 Cursor 官方方式安装 cursor-agent（cursor.com/install）。",
    common: true,
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    bin: "copilot",
    installMode: "vendor",
    installHint: "npm install -g @github/copilot",
    common: true,
  },
  // ---- 其余 20 ----
  {
    id: "antigravity",
    name: "Antigravity",
    bin: "antigravity",
    installMode: "vendor",
    installHint: "请安装 Google Antigravity，其自带 ACP 服务。",
    common: false,
  },
  {
    id: "devin",
    name: "Devin",
    bin: "devin",
    installMode: "vendor",
    installHint: "请通过 Cognition 官方渠道安装 devin CLI。",
    common: false,
  },
  {
    id: "droid",
    name: "Droid",
    bin: "droid",
    installMode: "vendor",
    installHint: "请通过 Factory 官方渠道安装 droid CLI。",
    common: false,
  },
  {
    id: "fast-agent",
    name: "Fast Agent",
    bin: "fast-agent",
    installMode: "vendor",
    installHint: "请用 uv/pip 安装 fast-agent-mcp（uvx fast-agent-mcp acp）。",
    common: false,
  },
  {
    id: "fx",
    name: "FX",
    bin: "fx",
    installMode: "vendor",
    installHint: "请通过官方渠道安装 fx CLI。",
    common: false,
  },
  {
    id: "grok-build",
    name: "Grok Build",
    bin: "grok",
    installMode: "vendor",
    installHint: "请通过 xAI 官方渠道安装 grok CLI。",
    common: false,
  },
  {
    id: "iflow",
    name: "iFlow CLI",
    bin: "iflow",
    installMode: "vendor",
    installHint: "请通过心流官方渠道安装 iflow CLI。",
    common: false,
  },
  {
    id: "junie",
    name: "Junie",
    bin: "junie",
    installMode: "vendor",
    installHint: "请通过 JetBrains 官方渠道安装 junie CLI。",
    common: false,
  },
  {
    id: "kilocode",
    name: "Kilo Code",
    bin: "kilocode",
    installMode: "npx",
    common: false,
  },
  {
    id: "kiro",
    name: "Kiro CLI",
    bin: "kiro-cli-chat",
    installMode: "vendor",
    installHint: "请通过 AWS 官方渠道安装 Kiro CLI（kiro-cli-chat）。",
    common: false,
  },
  {
    id: "mcode",
    name: "MCode",
    bin: "mcode",
    installMode: "vendor",
    installHint: "请通过官方渠道安装 mcode CLI。",
    common: false,
  },
  {
    id: "mux",
    name: "Mux",
    bin: "mux",
    installMode: "adapter",
    adapterPackage: "mux",
    adapterRange: "^0.28.0",
    common: false,
  },
  {
    id: "octomind",
    name: "Octomind",
    bin: "octomind",
    installMode: "vendor",
    installHint: "请通过 Octomind 官方渠道安装其 CLI。",
    common: false,
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    bin: "openclaw",
    installMode: "vendor",
    installHint: "请通过 OpenClaw 官方渠道安装其 CLI。",
    common: false,
  },
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    installMode: "npx",
    common: false,
  },
  {
    id: "pi",
    name: "Pi",
    bin: "pi",
    installMode: "adapter",
    adapterPackage: "pi-acp",
    adapterRange: "^0.0.33",
    common: false,
  },
  {
    id: "pool",
    name: "Pool",
    bin: "pool",
    installMode: "vendor",
    installHint: "请通过官方渠道安装 pool CLI。",
    common: false,
  },
  {
    id: "qoder",
    name: "Qoder CLI",
    bin: "qodercli",
    installMode: "vendor",
    installHint: "请通过 Alibaba 官方渠道安装 qodercli。",
    common: false,
  },
  {
    id: "trae",
    name: "Trae CLI",
    bin: "traecli",
    installMode: "vendor",
    installHint: "请通过字节跳动官方渠道安装 traecli。",
    common: false,
  },
  {
    id: "zeroclaw",
    name: "Zeroclaw",
    bin: "zeroclaw",
    installMode: "vendor",
    installHint: "请通过 Zeroclaw 官方渠道安装其 CLI。",
    common: false,
  },
];

export const COMMON_AI_ENGINES = AI_ENGINES.filter((engine) => engine.common);
export const OTHER_AI_ENGINES = AI_ENGINES.filter((engine) => !engine.common);

export const AI_ENGINE_IDS = AI_ENGINES.map((engine) => engine.id);

export const DEFAULT_AI_ENGINE = "claude";

export function isAiEngineId(value: string): boolean {
  return AI_ENGINE_IDS.includes(value);
}

export function aiEngineSpec(id: string): AiEngineSpec | undefined {
  return AI_ENGINES.find((engine) => engine.id === id);
}

/** 可直接选用的引擎：本机已装，或 acpx 无需预装即可拉起。 */
export function isEngineSelectable(spec: AiEngineSpec, installed: boolean): boolean {
  return installed || spec.installMode !== "vendor";
}
