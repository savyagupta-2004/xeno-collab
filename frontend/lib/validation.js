// Client-side checks for the auth forms. Same rules and messages as the backend validators,
// so the user sees the same text whichever side catches the problem.
import { VALIDATION } from '@/lib/constants';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requiredText = (value, label) => {
  const text = (value ?? '').trim();
  if (!text) return `${label} is required`;
  if (text.length > VALIDATION.textMaxLength) {
    return `${label} must be at most ${VALIDATION.textMaxLength} characters`;
  }
  return null;
};

const emailError = (value) => {
  const email = (value ?? '').trim();
  if (!email) return 'Email is required';
  if (!EMAIL.test(email)) return 'Enter a valid email address';
  return null;
};

const newPasswordError = (value) => {
  const password = value ?? '';
  if (!password) return 'Password is required';
  if (password.length < VALIDATION.passwordMinLength) {
    return `Password must be at least ${VALIDATION.passwordMinLength} characters`;
  }
  if (new TextEncoder().encode(password).length > VALIDATION.passwordMaxBytes) {
    return 'Password is too long';
  }
  return null;
};

// Drops fields without an error, so `Object.keys(errors).length === 0` means valid.
const compact = (errors) => Object.fromEntries(Object.entries(errors).filter(([, v]) => v));

export const validateLogin = ({ email, password }) =>
  compact({
    email: emailError(email),
    password: password ? null : 'Password is required',
  });

export const validateRegister = ({ name, email, password, storeName }) =>
  compact({
    name: requiredText(name, 'Name'),
    email: emailError(email),
    password: newPasswordError(password),
    storeName: requiredText(storeName, 'Store name'),
  });

// Turns an API error into what the form shows: messages next to fields, or one message on top.
export const toFormErrors = (error) => {
  if (error?.fields) return { fields: error.fields, message: '' };
  if (error?.code === 'EMAIL_TAKEN') return { fields: { email: error.message }, message: '' };
  return { fields: {}, message: error?.message || 'Something went wrong. Please try again.' };
};
