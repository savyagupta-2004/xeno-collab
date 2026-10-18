// Disabled and showing a spinner while its request is in flight, so it can't be double-clicked.
export default function SubmitButton({
  loading,
  loadingLabel,
  disabled = false,
  children,
  className = '',
  ...props
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      aria-busy={loading}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      )}
      {loading ? loadingLabel : children}
    </button>
  );
}
