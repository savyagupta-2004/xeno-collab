'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { toFormErrors } from '@/lib/validation';

// Shared state for the login and register forms: values, client-side validation,
// API errors, the in-flight flag, and the redirect to the dashboard on success.
export default function useAuthForm({ initialValues, validate, submit }) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Until React has attached onSubmit, a click would do a plain browser form submit.
  // The submit button stays disabled until then (and forms use method="post"), so
  // credentials can never end up in the URL.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const onChange = (event) => {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    // Clear a field's error as soon as the user edits it.
    if (fieldErrors[name]) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const errors = validate(values);
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await submit(values);
      // Stay "submitting" until the dashboard loads, so the button can't be pressed again.
      router.replace(ROUTES.overview);
      router.refresh();
    } catch (error) {
      const { fields, message } = toFormErrors(error);
      setFieldErrors(fields);
      setFormError(message);
      setSubmitting(false);
    }
  };

  return { values, fieldErrors, formError, submitting, ready, onChange, onSubmit };
}
