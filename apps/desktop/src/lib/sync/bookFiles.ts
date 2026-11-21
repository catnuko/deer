import type { Book } from "@/lib/types";
import type { SyncTransport } from "./transport";
import type { SyncPersistedState } from "./types";

/**
 * 书籍本体与封面的上传队列。
 *
 * 命名规则：`books/<contentHash>.<ext>`、`covers/<contentHash>.<ext>`。
 * 内容寻址天然幂等——同一本书在任何设备都是同一个远程路径，
 * 上传前先看网盘上有没有，有就跳过。
 */

export type FileSyncResult = {
  uploaded: number;
  failed: Array<{ bookId: string; remotePath: string; error: string }>;
};

function extensionOf(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match ? match[1].toLowerCase() : "bin";
}

export function remoteBookPath(book: Book): string | null {
  if (!book.contentHash || !book.filePath) return null;
  return `books/${book.contentHash}.${extensionOf(book.filePath)}`;
}

export function remoteCoverPath(book: Book): string | null {
  if (!book.contentHash || !book.coverPath) return null;
  return `covers/${book.contentHash}.${extensionOf(book.coverPath)}`;
}

/**
 * 把所有还没上传过的书文件/封面上传。
 * 已上传路径记在 `state.uploadedFiles`，大小一致即视为已同步。
 */
export async function uploadPendingFiles(options: {
  transport: SyncTransport;
  state: SyncPersistedState;
  books: Book[];
  onProgress?: (remotePath: string) => void;
}): Promise<FileSyncResult> {
  const { transport, state, books, onProgress } = options;
  const result: FileSyncResult = { uploaded: 0, failed: [] };

  for (const book of books) {
    const localPath = book.filePath;
    if (!localPath || book.cloudOnly) continue;

    const targets: Array<{ local: string; remote: string; size: number }> = [];
    const bookRemote = remoteBookPath(book);
    if (bookRemote) {
      targets.push({ local: localPath, remote: bookRemote, size: book.sizeBytes });
    }
    const coverRemote = remoteCoverPath(book);
    if (coverRemote) {
      targets.push({ local: book.coverPath as string, remote: coverRemote, size: 0 });
    }

    for (const target of targets) {
      if (state.uploadedFiles[target.remote] === target.size) continue;
      try {
        if (!(await transport.fileExists(target.remote))) {
          await transport.uploadFile(target.local, target.remote);
        }
        state.uploadedFiles[target.remote] = target.size;
        result.uploaded += 1;
        onProgress?.(target.remote);
      } catch (error) {
        result.failed.push({
          bookId: book.id,
          remotePath: target.remote,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}

/** 下载一本「云端书籍」的本体到本机（P2 的按需下载入口，内核已就绪）。 */
export async function downloadBookFile(options: {
  transport: SyncTransport;
  book: Book;
  localPath: string;
}): Promise<void> {
  const remote = remoteBookPath(options.book);
  if (!remote) throw new Error("这本书没有内容哈希，无法从云端定位");
  await options.transport.downloadFile(remote, options.localPath);
}