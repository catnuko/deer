'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/src/components/ThemeToggle';

export default function Home() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.txt') && !file.name.endsWith('.md')) {
      alert('请上传 .txt 或 .md 文件');
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setText(content);
    };
    reader.readAsText(file);
  }

  function handleStartReading() {
    if (!text.trim()) {
      alert('请先输入文本或上传文件');
      return;
    }

    sessionStorage.setItem('deer-reading-content', text);
    sessionStorage.setItem('deer-reading-title', fileName || '未命名文本');
    sessionStorage.setItem('deer-reading-type', fileName?.endsWith('.md') ? 'markdown' : 'text');
    router.push('/read');
  }

  return (
    <main className="page">
      <div className="top-bar">
        <ThemeToggle />
      </div>
      <section className="hero" aria-labelledby="deer-title">
        <p className="eyebrow">轻轻读，深深懂</p>
        <h1 id="deer-title">Deer</h1>
        <p className="lead">
          温和的 AI 阅读伙伴。带一页纸、一章书，或者一个问题来就好。
        </p>
      </section>

      <section className="input-section" aria-label="开始阅读">
        <h2>开始阅读</h2>
        <p className="input-hint">粘贴文本或上传 .txt / .md 文件，Deer 帮你更好地理解和思考。</p>

        <textarea
          className="text-input"
          placeholder="在此粘贴你要阅读的内容…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          aria-label="阅读内容输入框"
        />

        <div className="input-actions">
          <button
            className="upload-btn"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            📄 上传文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            aria-label="文件上传"
          />
          {fileName && <span className="file-name">已选择：{fileName}</span>}
        </div>

        <button className="cta start-btn" onClick={handleStartReading} type="button">
          开始阅读
        </button>
      </section>
    </main>
  );
}
