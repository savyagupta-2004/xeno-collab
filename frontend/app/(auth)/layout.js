export default function AuthLayout({ children }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-6 text-center text-lg font-semibold text-brand-600">Xeno Insights</p>
        {children}
      </div>
    </main>
  );
}
