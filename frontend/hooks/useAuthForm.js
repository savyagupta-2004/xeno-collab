'use client';

import { useRouter } from 'next/navigation';
import useSubmitForm from '@/hooks/useSubmitForm';
import { ROUTES } from '@/lib/constants';

// Login and register: the shared form behaviour plus the redirect to the dashboard on success.
export default function useAuthForm({ initialValues, validate, submit }) {
  const router = useRouter();

  return useSubmitForm({
    initialValues,
    validate,
    submit,
    keepSubmitting: true,
    onSuccess: () => {
      router.replace(ROUTES.overview);
      router.refresh();
    },
  });
}
