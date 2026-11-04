'use client';

import { useEffect, useState } from 'react';
import { toFormErrors } from '@/lib/validation';

// Shared state for forms that send secrets: values, client-side validation, API errors and
// the in-flight flag. Pass keepSubmitting when onSuccess navigates away, so the button can't
// be pressed again while the next page loads.
export default function useSubmitForm({
  initialValues,
  validate,
  submit,
  onSuccess,
  keepSubmitting = false,
}) {
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
      onSuccess(await submit(values));
      if (!keepSubmitting) setSubmitting(false);
    } catch (error) {
      const { fields, message } = toFormErrors(error);
      setFieldErrors(fields);
      setFormError(message);
      setSubmitting(false);
    }
  };

  return { values, fieldErrors, formError, submitting, ready, onChange, onSubmit };
}
