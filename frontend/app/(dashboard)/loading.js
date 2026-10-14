// Shown automatically by Next.js while any dashboard page is loading its data.
export default function DashboardLoading() {
  return (
    <section role="status" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 rounded-md bg-slate-200" />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-xl bg-slate-200" />
        <div className="h-24 rounded-xl bg-slate-200" />
        <div className="h-24 rounded-xl bg-slate-200" />
      </div>
      <div className="mt-6 h-64 rounded-xl bg-slate-200" />
    </section>
  );
}
