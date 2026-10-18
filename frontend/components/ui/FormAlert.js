const TONES = {
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
};

export default function FormAlert({ tone = 'error', children }) {
  if (!children) return null;

  return (
    <p role="alert" className={`rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}>
      {children}
    </p>
  );
}
