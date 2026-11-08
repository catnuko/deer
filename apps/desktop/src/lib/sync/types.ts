import type { BookFormat, ChatBookRef } from "@/lib/types";

/**
 * 同步内核的数据模型。
 *
 * v1 按产品决定「不做加密」：WebDAV 上落的就是明文 JSON 块，
 * 隐私边界只剩「用户自己的私有网盘目录」。加密层是纯叠加的
 * （encrypt(record) / decrypt(chunk)），后续要加时不必改动合并与引擎。
 */

/** 混合逻辑时钟：物理时间 + 计数器 + 设备号，给每条记录定全序。 */
export type Hlc = { wall: number; counter: number; node: string };

export type SyncKind =
  | "book"
  | "shelf"
  | "bookShelf"
  | "annotation"
  | "chatThread"
  | "chatMessage";

/**
 * 一条记录 = 某个实体的一次变更。
 * key 是跨设备稳定标识（书籍用内容哈希，其余用各自 UUID）；
 * deleted 为墓碑，data 缺省。
 */
export type SyncRecord = {
  kind: SyncKind;
  key: string;
  hlc: Hlc;
  deleted?: true;
  data?: unknown;
};

/* ------------------------------------------------------------------ */
/* 各类实体的同步载荷（不含设备本地字段：id、filePath、coverPath 等）      */
/* ------------------------------------------------------------------ */

export type BookSyncData = {
  contentHash: string;
  title: string;
  author: string;
  format: BookFormat;
  sizeBytes: number;
  tags: string[];
  addedAt: number;
  lastOpenedAt?: number;
  progress: number;
  lastLocationCfi?: string;
};

export type ShelfSyncData = { name: string; order: number };

export type AnnotationSyncData = {
  bookHash: string;
  cfi?: string;
  color: string;
  style?: string;
  excerpt?: string;
  note?: string;
  source?: "ai";
  createdAt: number;
};

export type ThreadSyncData = {
  bookHash: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type MessageSyncData = {
  threadKey: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  books?: ChatBookRef[];
  createdAt: number;
};

/** 一个操作日志块（WebDAV 上的 `ops/<deviceId>/<seq>.json`）。 */
export type OpChunk = {
  deviceId: string;
  seq: number;
  records: SyncRecord[];
};

/** 块清单项：远程目录里扫出来的块。 */
export type ChunkRef = { deviceId: string; seq: number };

/** 空间元信息（WebDAV 根目录的 `meta.json`，明文、极小）。 */
export type SyncManifest = {
  schema: 1;
  spaceId: string;
  createdAt: number;
};

/** 本机同步状态（落 `sync-state.json`）。 */
export type SyncPersistedState = {
  /** 本机设备号，首次开启同步时生成。 */
  deviceId: string;
  /** 所在空间 id，与 WebDAV 地址绑定。 */
  spaceId: string;
  /** 本机已分配的最大块号。 */
  seq: number;
  /** 待推送记录。 */
  outbox: SyncRecord[];
  /**
   * 本地快照指纹：key -> JSON 指纹，`null` 表示该 key 已被本地删除。
   * 引擎靠它和当前 store 状态做 diff，得到「这次要推哪些记录」。
   */
  shadow: Record<string, string | null>;
  /** key -> 最后一次本地删除的 HLC（墓碑）。 */
  tombstones: Record<string, { hlc: Hlc; at: number }>;
  /** key -> 已应用的最新远端 HLC，用于幂等与防止旧记录回滚。 */
  appliedHlc: Record<string, Hlc>;
  /** key -> 本机最后一次变更的 HLC：远端旧记录不许盖掉更新的本地修改。 */
  localHlc: Record<string, Hlc>;
  /** deviceId -> 已应用到第几个块。 */
  cursor: Record<string, number>;
  /** 已上传到网盘的文件：远程路径 -> 大小（内容寻址，大小变化说明内容变了）。 */
  uploadedFiles: Record<string, number>;
  lastSyncedAt?: number;
};

export type SyncPhase = "off" | "idle" | "syncing" | "error";

export type SyncReport = {
  /** 本次推送的元数据条数。 */
  pushed: number;
  /** 本次拉取的远端块数。 */
  pulled: number;
  /** 本次实际写入 store 的记录数。 */
  applied: number;
};