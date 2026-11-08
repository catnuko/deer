import { invoke } from "@tauri-apps/api/core";
import type { SyncTransport } from "./transport";
import type { ChunkRef, OpChunk, SyncManifest } from "./types";

/**
 * WebDAV 传输实现（默认 provider）。
 *
 * 为什么走 Rust：webview 的 fetch 发不出 PROPFIND，且多数 WebDAV 服务
 * 不返回 CORS 头。所有请求经 `webdav_request` / `webdav_upload_file` /
 * `webdav_download_file` 三个 Tauri command 出站。
 *
 * 网盘目录布局（baseUrl 即用户指定的 deer-sync 根目录）：
 *
 *   meta.json                       空间元信息（明文，极小）
 *   ops/<deviceId>/<seq>.json       元数据操作日志块（明文 JSON）
 *   books/<contentHash>.<ext>       书籍本体
 *   covers/<contentHash>.<ext>      封面
 */

type DavResponse = {
  status: number;
  etag: string | null;
  body: string | null;
};

type DavEntry = {
  href: string;
  isCollection: boolean;
  etag: string | null;
};

export type WebDavConfig = {
  /** 用户填写的基础地址，如 https://dav.jianguoyun.com/dav/deer-sync */
  baseUrl: string;
  username: string;
  password: string;
  deviceId: string;
};

export class WebDavTransport implements SyncTransport {
  private ready = false;

  constructor(private readonly config: WebDavConfig) {}

  /* -------------------------------------------------------------- */
  /* 底层请求                                                        */
  /* -------------------------------------------------------------- */

  private url(path: string): string {
    const base = this.config.baseUrl.trim().replace(/\/+$/, "");
    const suffix = path
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return suffix ? `${base}/${suffix}` : base;
  }

  private async request(
    method: string,
    path: string,
    options: { body?: string; depth?: string; contentType?: string } = {},
  ): Promise<DavResponse> {
    return invoke<DavResponse>("webdav_request", {
      method,
      url: this.url(path),
      username: this.config.username,
      password: this.config.password,
      body: options.body === undefined ? null : Array.from(new TextEncoder().encode(options.body)),
      contentType: options.contentType ?? null,
      depth: options.depth ?? null,
    });
  }

  private assertOk(response: DavResponse, action: string): void {
    if (response.status >= 200 && response.status < 300) return;
    throw new Error(`${action}失败：HTTP ${response.status}`);
  }

  private async propfind(path: string, depth: "0" | "1"): Promise<DavEntry[]> {
    const response = await this.request("PROPFIND", path, { depth });
    if (response.status === 404) return [];
    this.assertOk(response, "列目录");
    return parseDavEntries(response.body ?? "");
  }

  /* -------------------------------------------------------------- */
  /* SyncTransport 实现                                               */
  /* -------------------------------------------------------------- */

  async testConnection() {
    try {
      const response = await this.request("PROPFIND", "", { depth: "0" });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: "认证失败：请检查账号与应用密码" };
      }
      if (response.status === 404) {
        return { ok: false, message: "目录不存在：请先在网盘里创建该文件夹" };
      }
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, message: "连接成功" };
      }
      return { ok: false, message: `连接失败：HTTP ${response.status}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async ensureReady() {
    if (this.ready) return;
    // MKCOL 幂等：已存在时服务端返回 405，忽略即可。
    await this.request("MKCOL", "ops");
    await this.request("MKCOL", `ops/${this.config.deviceId}`);
    this.ready = true;
  }

  async readManifest(): Promise<SyncManifest | null> {
    const response = await this.request("GET", "meta.json");
    if (response.status === 404) return null;
    this.assertOk(response, "读取空间信息");
    try {
      return JSON.parse(response.body ?? "") as SyncManifest;
    } catch {
      return null;
    }
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const response = await this.request("PUT", "meta.json", {
      body: JSON.stringify(manifest),
      contentType: "application/json",
    });
    this.assertOk(response, "写入空间信息");
  }

  async listChunks(): Promise<ChunkRef[]> {
    await this.ensureReady();
    const devices = await this.propfind("ops", "1");
    const refs: ChunkRef[] = [];

    for (const entry of devices) {
      if (!entry.isCollection) continue;
      const deviceId = lastSegment(entry.href);
      if (!deviceId || deviceId === "ops") continue;
      const files = await this.propfind(`ops/${deviceId}`, "1");
      for (const file of files) {
        if (file.isCollection) continue;
        const match = /^(\d+)\.json$/.exec(lastSegment(file.href));
        if (match) refs.push({ deviceId, seq: Number(match[1]) });
      }
    }

    return refs.sort(
      (a, b) => a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq,
    );
  }

  async getChunk(ref: ChunkRef): Promise<OpChunk> {
    const path = `ops/${ref.deviceId}/${String(ref.seq).padStart(6, "0")}.json`;
    const response = await this.request("GET", path);
    this.assertOk(response, "拉取同步块");
    return JSON.parse(response.body ?? "") as OpChunk;
  }

  async putChunk(chunk: OpChunk): Promise<void> {
    await this.ensureReady();
    const path = `ops/${chunk.deviceId}/${String(chunk.seq).padStart(6, "0")}.json`;
    const response = await this.request("PUT", path, {
      body: JSON.stringify(chunk),
      contentType: "application/json",
    });
    this.assertOk(response, "上传同步块");
  }

  async fileExists(remotePath: string): Promise<boolean> {
    const response = await this.request("PROPFIND", remotePath, { depth: "0" });
    if (response.status === 404) return false;
    if (response.status >= 200 && response.status < 300) return true;
    throw new Error(`检查远端文件失败：HTTP ${response.status}`);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const status = await invoke<number>("webdav_upload_file", {
      url: this.url(remotePath),
      username: this.config.username,
      password: this.config.password,
      localPath,
    });
    if (status >= 300) throw new Error(`上传书籍文件失败：HTTP ${status}`);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const status = await invoke<number>("webdav_download_file", {
      url: this.url(remotePath),
      username: this.config.username,
      password: this.config.password,
      localPath,
    });
    if (status >= 300) throw new Error(`下载书籍文件失败：HTTP ${status}`);
  }

  async deleteFile(remotePath: string): Promise<void> {
    const response = await this.request("DELETE", remotePath);
    if (response.status === 404) return;
    this.assertOk(response, "删除云端文件");
  }
}

/* ------------------------------------------------------------------ */
/* PROPFIND XML 解析（只认 href / resourcetype / getetag，够用即可）       */
/* ------------------------------------------------------------------ */

function parseDavEntries(xml: string): DavEntry[] {
  const entries: DavEntry[] = [];
  const blocks =
    xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];

  for (const block of blocks) {
    const href = extractText(block, "href");
    if (!href) continue;
    const resourceType = extractText(block, "resourcetype") ?? "";
    entries.push({
      href,
      isCollection: /<(?:[\w-]+:)?collection\b/i.test(resourceType),
      etag: extractText(block, "getetag"),
    });
  }

  return entries;
}

function extractText(xml: string, localName: string): string | null {
  const match = new RegExp(
    `<(?:[\\w-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${localName}>`,
    "i",
  ).exec(xml);
  return match ? match[1].trim() : null;
}

/** 取 href 的最后一段（解码后），目录结尾的斜杠先去掉。 */
function lastSegment(href: string): string {
  const withoutTrailing = href.replace(/\/+$/, "");
  const path = withoutTrailing.replace(/^https?:\/\/[^/]+/i, "");
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}