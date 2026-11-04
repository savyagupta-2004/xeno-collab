const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2 text-sm">
    <dt className="text-slate-500">{label}</dt>
    <dd className="truncate font-medium">{children}</dd>
  </div>
);

export default function StoreStatusCard({ store }) {
  const { connected, shopDomain, lastSyncedAt, counts } = store;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        <h2 className="text-lg font-semibold">{connected ? 'Connected' : 'Not connected'}</h2>
      </div>
      <dl className="mt-3 divide-y divide-slate-100">
        <Row label="Store">{shopDomain ?? '—'}</Row>
        <Row label="Last sync">
          {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('en-IN') : 'Never'}
        </Row>
        <Row label="Customers">{counts.customers}</Row>
        <Row label="Products">{counts.products}</Row>
        <Row label="Orders">{counts.orders}</Row>
      </dl>
    </section>
  );
}
