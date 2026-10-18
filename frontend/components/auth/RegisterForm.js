'use client';

import FormAlert from '@/components/ui/FormAlert';
import FormField from '@/components/ui/FormField';
import SubmitButton from '@/components/ui/SubmitButton';
import useAuthForm from '@/hooks/useAuthForm';
import { session } from '@/lib/api';
import { VALIDATION } from '@/lib/constants';
import { validateRegister } from '@/lib/validation';

export default function RegisterForm() {
  const { values, fieldErrors, formError, submitting, ready, onChange, onSubmit } = useAuthForm({
    initialValues: { name: '', email: '', password: '', storeName: '' },
    validate: validateRegister,
    submit: session.register,
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
      <FormAlert>{formError}</FormAlert>
      <FormField
        id="name"
        label="Your name"
        autoComplete="name"
        value={values.name}
        onChange={onChange}
        error={fieldErrors.name}
        disabled={submitting}
      />
      <FormField
        id="storeName"
        label="Store name"
        autoComplete="organization"
        value={values.storeName}
        onChange={onChange}
        error={fieldErrors.storeName}
        disabled={submitting}
      />
      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={values.email}
        onChange={onChange}
        error={fieldErrors.email}
        disabled={submitting}
      />
      <FormField
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder={`At least ${VALIDATION.passwordMinLength} characters`}
        value={values.password}
        onChange={onChange}
        error={fieldErrors.password}
        disabled={submitting}
      />
      <SubmitButton loading={submitting} disabled={!ready} loadingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
