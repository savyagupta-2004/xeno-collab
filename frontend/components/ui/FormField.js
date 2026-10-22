export default function FormField({ id, label, error, ...inputProps }) {
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1 text-left">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`block w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 disabled:bg-slate-50 ${
          error
            ? 'border-rose-400 focus:ring-rose-200'
            : 'border-slate-300 focus:border-brand-600 focus:ring-brand-50'
        }`}
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
