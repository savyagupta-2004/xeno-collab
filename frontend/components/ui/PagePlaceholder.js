export default function PagePlaceholder({ title }) {
  return (
    <section>
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
        Coming soon
      </div>
    </section>
  );
}
