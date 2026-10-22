// Regression: if the form is submitted before React hydrates, the browser does a plain form
// submit. With the default GET that would put the password in the URL. The server-rendered
// forms must therefore use POST and start with the submit button disabled.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LoginForm from '@/components/auth/LoginForm';
import RegisterForm from '@/components/auth/RegisterForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe.each([
  ['LoginForm', LoginForm],
  ['RegisterForm', RegisterForm],
])('%s before hydration', (_name, Form) => {
  const html = renderToString(createElement(Form));

  it('uses method="post", so a fallback submit never puts credentials in the URL', () => {
    expect(html).toMatch(/<form[^>]*method="post"/);
  });

  it('renders the submit button disabled', () => {
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });
});
