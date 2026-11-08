import type { ChunkRef, OpChunk, SyncManifest } from "./types";

/** 文件传输进度（书籍本体/封面）。 */
export type FileProgress = {
  remotePath: string;
  transferred: number;
  total: number;
};

/**
 * 传输层接口：同步内核只依赖这 7 件事，换后端不动内核。
 * v1 只有 WebDAV 实现；GitHub/S3/云盘按同一接口接。
 */
export interface SyncTransport {
  /** 连接测试：不抛错，返回可展示的结果。 */
  testConnection(): Promise<{ ok: boolean; message: string }>;
  /** 幂等建目录（ops/ 与 ops/<本机设备>/）。 */
  ensureReady(): Promise<void>;
  readManifest(): Promise<SyncManifest | null>;
  writeManifest(manifest: SyncManifest): Promise<void>;
  /** 列出网盘上所有设备的块。 */
  listChunks(): Promise<ChunkRef[]>;
  getChunk(ref: ChunkRef): Promise<OpChunk>;
  putChunk(chunk: OpChunk): Promise<void>;
  /** 内容寻址文件的三个动作（书籍/封面）。 */
  fileExists(remotePath: string): Promise<boolean>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
}

/**
 * 内存传输：单测里模拟两台设备共享同一个「网盘」。
 * 把所有实例接到同一个 MemoryBackend 上，就得到多设备场景。
 */
export type MemoryBackend = {
  files: Map<string, string>;
  binary: Map<string, Uint8Array>;
};

export function createMemoryBackend(): MemoryBackend {
  return { files: new Map(), binary: new Map() };
}

export class MemoryTransport implements SyncTransport {
  constructor(
    private readonly backend: MemoryBackend,
    /** 模拟网络故障：抛错即可让引擎走失败分支。 */
    public failNext: ((op: string) => Error | null) | null = null,
  ) {}

  private maybeFail(op: string) {
    const error = this.failNext?.(op) ?? null;
    if (error) {
      this.failNext = null;
      throw error;
    }
  }

  async testConnection() {
    return { ok: true, message: "内存传输可用" };
  }

  async ensureReady() {}

  async readManifest(): Promise<SyncManifest | null> {
    this.maybeFail("manifest:read");
    const raw = this.backend.files.get("meta.json");
    return raw ? (JSON.parse(raw) as SyncManifest) : null;
  }

  async writeManifest(manifest: SyncManifest) {
    this.maybeFail("manifest:write");
    this.backend.files.set("meta.json", JSON.stringify(manifest));
  }

  async listChunks(): Promise<ChunkRef[]> {
    this.maybeFail("chunks:list");
    const refs: ChunkRef[] = [];
    for (const path of this.backend.files.keys()) {
      const match = /^ops\/([^/]+)\/(\d+)\.json$/.exec(path);
      if (match) refs.push({ deviceId: match[1], seq: Number(match[2]) });
    }
    return refs.sort((a, b) => a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq);
  }

  async getChunk(ref: ChunkRef): Promise<OpChunk> {
    this.maybeFail("chunk:get");
    const raw = this.backend.files.get(chunkPath(ref.deviceId, ref.seq));
    if (!raw) throw new Error(`块不存在：${ref.deviceId}/${ref.seq}`);
    return JSON.parse(raw) as OpChunk;
  }

  async putChunk(chunk: OpChunk) {
    this.maybeFail("chunk:put");
    this.backend.files.set(
      chunkPath(chunk.deviceId, chunk.seq),
      JSON.stringify(chunk),
    );
  }

  async fileExists(remotePath: string) {
    this.maybeFail("file:exists");
    return this.backend.binary.has(remotePath);
  }

  async uploadFile(localPath: string, remotePath: string) {
    this.maybeFail("file:upload");
    // 内存传输不读真实文件，只记下路径便于断言。
    void localPath;
    this.backend.binary.set(remotePath, new Uint8Array());
  }

  async downloadFile(remotePath: string, localPath: string) {
    this.maybeFail("file:download");
    void localPath;
    if (!this.backend.binary.has(remotePath)) {
      throw new Error(`远程文件不存在：${remotePath}`);
    }
  }

  async deleteFile(remotePath: string) {
    this.maybeFail("file:delete");
    this.backend.binary.delete(remotePath);
  }
}

export function chunkPath(deviceId: string, seq: number): string {
  return `ops/${deviceId}/${String(seq).padStart(6, "0")}.json`;
}