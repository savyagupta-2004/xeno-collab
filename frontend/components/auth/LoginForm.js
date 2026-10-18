'use client';

import FormAlert from '@/components/ui/FormAlert';
import FormField from '@/components/ui/FormField';
import SubmitButton from '@/components/ui/SubmitButton';
import useAuthForm from '@/hooks/useAuthForm';
import { session } from '@/lib/api';
import { validateLogin } from '@/lib/validation';

export default function LoginForm() {
  const { values, fieldErrors, formError, submitting, ready, onChange, onSubmit } = useAuthForm({
    initialValues: { email: '', password: '' },
    validate: validateLogin,
    submit: session.login,
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
      <FormAlert>{formError}</FormAlert>
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
        autoComplete="current-password"
        value={values.password}
        onChange={onChange}
        error={fieldErrors.password}
        disabled={submitting}
      />
      <SubmitButton loading={submitting} disabled={!ready} loadingLabel="Logging in…">
        Log in
      </SubmitButton>
    </form>
  );
}
