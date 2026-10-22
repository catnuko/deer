import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Deer — 温和的 AI 阅读伙伴',
  description:
    'Deer 帮你读懂书、提出更好的问题、连接散落的念头。轻轻读，深深懂。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
