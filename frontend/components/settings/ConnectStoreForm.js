'use client';

import FormAlert from '@/components/ui/FormAlert';
import FormField from '@/components/ui/FormField';
import SubmitButton from '@/components/ui/SubmitButton';
import useSubmitForm from '@/hooks/useSubmitForm';
import { api } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { validateConnectStore } from '@/lib/validation';

// With connectedDomain set, the domain is fixed and the form only replaces the access token.
export default function ConnectStoreForm({ connectedDomain, onConnected }) {
  const { values, fieldErrors, formError, submitting, ready, onChange, onSubmit } = useSubmitForm({
    initialValues: { shopDomain: connectedDomain ?? '', accessToken: '' },
    validate: validateConnectStore,
    submit: (details) => api.post(API_ENDPOINTS.storeConnect, details),
    onSuccess: onConnected,
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
      <h2 className="text-lg font-semibold">
        {connectedDomain ? 'Update access token' : 'Connect your Shopify store'}
      </h2>
      <FormAlert>{formError}</FormAlert>
      <FormField
        id="shopDomain"
        label="Shop domain"
        placeholder="your-store.myshopify.com"
        autoComplete="off"
        value={values.shopDomain}
        onChange={onChange}
        error={fieldErrors.shopDomain}
        disabled={submitting}
        readOnly={Boolean(connectedDomain)}
      />
      <FormField
        id="accessToken"
        label="Admin API access token"
        type="password"
        autoComplete="off"
        value={values.accessToken}
        onChange={onChange}
        error={fieldErrors.accessToken}
        disabled={submitting}
      />
      <SubmitButton loading={submitting} disabled={!ready} loadingLabel="Checking with Shopify…">
        {connectedDomain ? 'Update token' : 'Connect store'}
      </SubmitButton>
    </form>
  );
}
