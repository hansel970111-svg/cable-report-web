import type { Metadata } from 'next';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  applicationName: 'Cable Report Generator',
  title: {
    default: '线缆测试报告编辑器',
    template: '%s | 线缆测试报告编辑器',
  },
  description: '用于导入 Excel 布线表并生成线缆测试报告的桌面和网页工具。',
  keywords: [
    '线缆测试报告',
    'Cable Report Generator',
    'Excel 布线表',
    'LC 测试报告',
    'MPO 测试报告',
    'Cat 5e 测试报告',
  ],
  authors: [{ name: 'Cable Report Generator' }],
  generator: 'Cable Report Generator',
  openGraph: {
    title: '线缆测试报告编辑器',
    description: '导入 Excel 布线表，生成 LC、MPO、Cat 5e 等线缆测试报告。',
    siteName: 'Cable Report Generator',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const devBrowserMode = process.env.CABLE_DEV_BROWSER_MODE === '1';
  return (
    <html
      lang="zh-CN"
      data-dev-browser-mode={devBrowserMode ? 'true' : undefined}
    >
      <body className={`antialiased`}>
        {children}
      </body>
    </html>
  );
}
