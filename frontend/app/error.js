'use client';

// Shown when a page or layout fails, e.g. the dashboard can't reach the API to check the
// session. The user stays logged in and can retry.
export default function AppError({ reset }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-slate-500">
          We couldn’t load this page. The server may be unreachable, please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
