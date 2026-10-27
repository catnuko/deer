'use client';

import type { SVGProps } from 'react';

/**
 * 线稿鹿角 logo（lucide 线性语言，1.5px 描边）。设计板 02 的标识：
 * 48px 主色圆角块 + 白色鹿角线稿。
 */
export function AntlerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* 主干与分叉的对称鹿角 + 脸部中轴 */}
      <path d="M9 21v-4.5c0-1.5-1-2.5-2.5-3.5S4 10.5 4 8.5c0-1.8.9-3.5 2-4.5" />
      <path d="M15 21v-4.5c0-1.5 1-2.5 2.5-3.5s2.5-2.5 2.5-4.5c0-1.8-.9-3.5-2-4.5" />
      <path d="M6 4c1 .3 2 1.2 2.4 2.4C8.8 7.6 8.6 9 8 10" />
      <path d="M18 4c-1 .3-2 1.2-2.4 2.4-.4 1.2-.2 2.6.4 3.6" />
      <path d="M12 9v4" />
      <path d="M10.5 14.5c.4.7 1 1 1.5 1s1.1-.3 1.5-1" />
    </svg>
  );
}
