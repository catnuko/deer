/**
 * 书籍内容哈希（SHA-256，hex）。
 *
 * 用途：书籍跨设备身份。本地 id 是本机随机 UUID、filePath 是本机路径，
 * 换设备后都对不上；同一份文件在任意设备算出的 contentHash 相同，
 * 于是进度、笔记、会话都能按它归位。
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // 复制成独立的 ArrayBuffer：plugin-fs 返回的 Uint8Array 底层可能是共享缓冲区，
  // 不能直接当 BufferSource 传给 WebCrypto（类型与内存语义都不匹配）。
  const source = bytes.slice().buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 从哈希表里按 contentHash 找本地书籍。 */
export function bookKeyOf(contentHash: string): string {
  return `bk:${contentHash}`;
}

export function contentHashOfBookKey(key: string): string {
  return key.startsWith("bk:") ? key.slice(3) : key;
}