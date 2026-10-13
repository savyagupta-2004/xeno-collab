export default function PagePlaceholder({ title, description }) {
  return (
    <section>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-400">
        Coming soon
      </div>
    </section>
  );
}
