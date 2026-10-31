import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/** Sidebar + content for /scheduled and /sent. Below 900px the sidebar stacks above the content. */
export function AppShell() {
  return (
    <div className="flex min-h-screen bg-white max-[900px]:flex-col">
      <Sidebar />
      <main className="min-w-0 flex-1 pb-10 pl-[27px] pr-[20px] max-[900px]:px-4">
        <Outlet />
      </main>
    </div>
  );
}
