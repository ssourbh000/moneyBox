'use client';

import Sidebar from './Sidebar';

export default function AppShell({ children, mainClassName }: { children: React.ReactNode; mainClassName?: string }) {
  return (
    <div className="flex min-h-screen bg-gray-900 text-gray-100">
      <Sidebar />
      <main className={`flex-1 overflow-auto p-6 transition-colors duration-700 ${mainClassName ?? ''}`}>{children}</main>
    </div>
  );
}
