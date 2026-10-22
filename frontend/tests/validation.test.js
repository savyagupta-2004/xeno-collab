import { describe, expect, it } from 'vitest';
import { toFormErrors, validateLogin, validateRegister } from '@/lib/validation';

const validRegistration = {
  name: 'Asha Rao',
  email: 'asha@store.com',
  password: 'correct-horse-1',
  storeName: 'Asha Apparel',
};

describe('validateRegister', () => {
  it('accepts valid details', () => {
    expect(validateRegister(validRegistration)).toEqual({});
  });

  it('reports every invalid field with the same messages as the backend', () => {
    expect(
      validateRegister({ name: ' ', email: 'nope', password: 'short', storeName: '' }),
    ).toEqual({
      name: 'Name is required',
      email: 'Enter a valid email address',
      password: 'Password must be at least 8 characters',
      storeName: 'Store name is required',
    });
  });

  it('enforces the 100 character limit on text fields', () => {
    expect(validateRegister({ ...validRegistration, storeName: 'x'.repeat(101) })).toEqual({
      storeName: 'Store name must be at most 100 characters',
    });
  });

  it('rejects passwords over 72 bytes (bcrypt limit), counting multi-byte characters', () => {
    expect(validateRegister({ ...validRegistration, password: 'é'.repeat(37) })).toEqual({
      password: 'Password is too long',
    });
  });
});

describe('validateLogin', () => {
  it('requires a valid email and a password, without repeating the length rules', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Email is required',
      password: 'Password is required',
    });
    expect(validateLogin({ email: 'a@b.co', password: 'x' })).toEqual({});
  });
});

describe('toFormErrors', () => {
  it('shows backend field errors next to the fields', () => {
    expect(toFormErrors({ code: 'VALIDATION_ERROR', fields: { email: 'Bad' } })).toEqual({
      fields: { email: 'Bad' },
      message: '',
    });
  });

  it('shows a duplicate email under the email field', () => {
    expect(toFormErrors({ code: 'EMAIL_TAKEN', message: 'Already exists' })).toEqual({
      fields: { email: 'Already exists' },
      message: '',
    });
  });

  it('shows other errors (wrong password, server down) above the form', () => {
    expect(
      toFormErrors({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }),
    ).toEqual({
      fields: {},
      message: 'Invalid email or password',
    });
    expect(toFormErrors(undefined).message).toMatch(/something went wrong/i);
  });
});
