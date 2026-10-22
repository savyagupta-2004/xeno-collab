import Sidebar from '@/components/layout/Sidebar';
import requireSession from '@/lib/requireSession';

// The backend confirms the session (see lib/requireSession.js) before the dashboard renders.
// Each page calls requireSession() too, because Next.js skips this layout when navigating
// between dashboard pages.
export default async function DashboardLayout({ children }) {
  const { user, tenant } = await requireSession();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar user={user} tenant={tenant} />
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
