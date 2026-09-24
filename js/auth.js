/*
 * auth.js — Authentication service layer.
 *
 * Single responsibility: provide a provider-neutral authentication API backed
 * by Supabase Auth. All Supabase-specific details are encapsulated here; no
 * other module needs to know about the Supabase SDK.
 *
 * Exported API (provider-neutral):
 *   signUp(email, password)          Register a new user.
 *   signIn(email, password)          Sign in an existing user.
 *   signOut()                        End the current session.
 *   getCurrentUser()                 Return the cached authenticated user or null.
 *   onAuthStateChange(callback)      Subscribe to auth state events.
 *   resetPassword(email)             Send a password-reset email.
 *
 * All functions return a normalized result shape:
 *   { ok: true,  user }   — on success (where a user is returned)
 *   { ok: true }          — on success (where no user is returned, e.g. signOut)
 *   { ok: false, error: { code, message } } — on any failure
 *
 * Security invariants enforced by this module:
 *   - Passwords are never stored, logged, or returned to callers.
 *   - Authentication tokens are never logged.
 *   - The service_role key is never imported or used here.
 *   - No privileged credentials exist in this file.
 *   - Supabase Auth manages the session JWT in its own localStorage key;
 *     this module does not write auth data to localStorage manually.
 *   - The user's immutable Supabase UID (user.id) is the future ownership key.
 *     Email address is never used as a data-ownership identifier.
 *
 * Supabase client: obtained via `getSupabaseClient()` from supabase.js, which
 * owns the singleton lifecycle. This module never instantiates its own client,
 * ensuring a single shared instance across auth and future storage layers.
 *
 * Layer: Authentication service. Imports config.js and supabase.js only.
 * Does not import storage.js, transactions.js, categories.js, dashboard.js,
 * or any UI module. app.js imports this module starting in Task 15.8.
 */

import { SUPABASE_CONFIG } from './config.js';
import { getSupabaseClient } from './supabase.js';

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

/**
 * Known Supabase Auth error message/code fragments → normalized error codes.
 * We match on the raw SDK message string internally only — the raw message
 * never escapes this module. supabase-js v2 does not expose a stable
 * machine-readable error code enum for all cases, so string matching is used.
 * @type {Array<{ pattern: RegExp, code: string }>}
 */
const ERROR_MAP = [
  { pattern: /invalid login credentials/i,                     code: 'invalid-credentials' },
  { pattern: /email not confirmed/i,                            code: 'email-not-confirmed' },
  { pattern: /user already registered/i,                        code: 'email-in-use' },
  { pattern: /password should be at least/i,                    code: 'weak-password' },
  { pattern: /unable to validate email address/i,               code: 'invalid-email' },
  { pattern: /invalid email/i,                                  code: 'invalid-email' },
  { pattern: /user not found/i,                                 code: 'user-not-found' },
  { pattern: /email rate limit exceeded/i,                      code: 'rate-limited' },
  { pattern: /for security purposes.*you can only request/i,    code: 'rate-limited' },
  { pattern: /network/i,                                        code: 'network-error' },
  { pattern: /fetch/i,                                          code: 'network-error' },
];

/**
 * Static safe messages keyed by normalized error code (Req 25.9, F-01).
 * These are the ONLY strings that escape _normalizeError() — never the raw
 * SDK message. Each message is ≤ 200 characters and contains no credentials,
 * tokens, or internal server details.
 * @type {Record<string, string>}
 */
const SAFE_MESSAGES = {
  'invalid-credentials':  'Incorrect email or password.',
  'email-not-confirmed':  'Please confirm your email address before signing in.',
  'email-in-use':         'An account with this email address already exists.',
  'weak-password':        'Password does not meet the minimum requirements.',
  'invalid-email':        'Please enter a valid email address.',
  'user-not-found':       'No account found with this email address.',
  'rate-limited':         'Too many attempts. Please wait a moment and try again.',
  'network-error':        'A network error occurred. Please check your connection.',
  'validation-error':     'Please check your input and try again.',
  'not-configured':       'Authentication is not configured.',
  'unknown':              'An unexpected error occurred. Please try again.',
};

/**
 * Map a raw Supabase error (or any Error) to a normalized error object.
 *
 * Security guarantee (Req 25.9, F-01):
 *   - The raw SDK message is used ONLY for internal pattern matching to derive
 *     the error code. It NEVER appears in the returned object.
 *   - The returned `message` is always a static string from SAFE_MESSAGES.
 *   - `code` is ≤ 50 characters; `message` is ≤ 200 characters.
 *   - No JWT, stack trace, or credential can escape through either field.
 *
 * @param {unknown} raw  The raw error from the Supabase SDK.
 * @returns {{ code: string, message: string }}
 */
function _normalizeError(raw) {
  // Extract the raw SDK message for internal pattern matching ONLY.
  // This string is never returned to callers.
  const rawMsg = (raw && typeof raw === 'object' && 'message' in raw)
    ? String(raw.message)
    : String(raw ?? '');

  // Derive the error code by pattern-matching the raw message internally.
  let code = 'unknown';
  for (const entry of ERROR_MAP) {
    if (entry.pattern.test(rawMsg)) {
      code = entry.code;
      break;
    }
  }

  // Return ONLY the static safe message — the raw SDK message never escapes.
  return { code, message: SAFE_MESSAGES[code] ?? SAFE_MESSAGES['unknown'] };
}

/**
 * Produce a normalized result for when the Supabase client could not be
 * initialised (placeholders in config.js or CDN load failure).
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function _configError() {
  return {
    ok: false,
    error: {
      code: 'not-configured',
      message:
        'Supabase is not configured. Replace the placeholder values in ' +
        'js/config.js with your project URL and anon key before using ' +
        'authentication features.',
    },
  };
}

// ---------------------------------------------------------------------------
// Normalised User shape
// ---------------------------------------------------------------------------

/**
 * Reduce a raw Supabase User object to the minimal shape consumed by the
 * application. Using `id` (immutable UUID) as the ownership identifier —
 * never `email`, which can change.
 *
 * @param {object} supabaseUser  Raw user object from supabase-js.
 * @returns {{ id: string, email: string }}
 */
function _normalizeUser(supabaseUser) {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? '',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a new user with email and password.
 *
 * Validates locally that both fields are present before calling the provider.
 * Returns the created user on success. Note: depending on your Supabase
 * project's "Confirm email" setting, the user may need to verify their
 * address before they can sign in — check `result.user` for
 * `identities.length === 0` or a null session to detect the unconfirmed case.
 *
 * Passwords are NEVER stored, logged, or returned.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ ok: true, user: { id: string, email: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function signUp(email, password) {
  // Client-side pre-validation (Req 25.11, F-07) — runs before any network call.
  // Returns 'validation-error' so the UI can distinguish local vs server errors.
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return { ok: false, error: { code: 'validation-error', message: 'Please enter a valid email address.' } };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { ok: false, error: { code: 'validation-error', message: 'Please enter a valid email address.' } };
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return { ok: false, error: { code: 'validation-error', message: 'Password must be at least 8 characters.' } };
  }

  const client = await getSupabaseClient();
  if (!client) return _configError();

  const { data, error } = await client.auth.signUp({ email: email.trim(), password });

  if (error) {
    return { ok: false, error: _normalizeError(error) };
  }
  if (!data.user) {
    // Can happen when email confirmation is required and the user is new but
    // unconfirmed — Supabase returns no session yet.
    return {
      ok: false,
      error: {
        code: 'email-not-confirmed',
        message: 'Registration successful. Please check your email to confirm your account.',
      },
    };
  }

  return { ok: true, user: _normalizeUser(data.user) };
}

/**
 * Sign in an existing user with email and password.
 *
 * Uses `signInWithPassword` (the v2 method for email/password auth).
 * Returns the authenticated user on success; a normalized error on failure.
 * The session JWT is managed by supabase-js in its own localStorage key —
 * this module does not write auth data to localStorage manually.
 *
 * Passwords are NEVER stored, logged, or returned.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ ok: true, user: { id: string, email: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function signIn(email, password) {
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return { ok: false, error: { code: 'invalid-email', message: 'Email is required.' } };
  }
  if (!password || typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: { code: 'weak-password', message: 'Password is required.' } };
  }

  const client = await getSupabaseClient();
  if (!client) return _configError();

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    return { ok: false, error: _normalizeError(error) };
  }
  if (!data.user) {
    return { ok: false, error: { code: 'unknown', message: 'Sign-in failed. Please try again.' } };
  }

  return { ok: true, user: _normalizeUser(data.user) };
}

/**
 * Sign out the currently authenticated user.
 *
 * Calls Supabase Auth sign-out, which clears the session JWT that supabase-js
 * manages. This module does NOT manually clear LocalStorage finance data —
 * that is handled separately by app.js in Task 15.5 (Logout UI).
 *
 * @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>}
 */
export async function signOut() {
  const client = await getSupabaseClient();
  if (!client) return _configError();

  const { error } = await client.auth.signOut();

  if (error) {
    return { ok: false, error: _normalizeError(error) };
  }
  return { ok: true };
}

/**
 * Return the currently authenticated user from the active Supabase session.
 *
 * Uses `getUser()` (v2 recommended method) which verifies the JWT with the
 * server rather than relying solely on the cached localStorage value.
 * Returns null when there is no active session or when the client is not
 * yet configured.
 *
 * The returned `user.id` is the immutable Supabase UUID — the future ownership
 * key for all user-scoped cloud records. Email is included for display only.
 *
 * @returns {Promise<{ id: string, email: string } | null>}
 */
export async function getCurrentUser() {
  const client = await getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    return null;
  }
  return _normalizeUser(data.user);
}

/**
 * Subscribe to authentication state changes.
 *
 * Wraps `supabase.auth.onAuthStateChange` with the provider-neutral interface.
 * The `callback` receives `(event, user)` where:
 *   - `event` is a string such as 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED',
 *     'PASSWORD_RECOVERY', 'INITIAL_SESSION', 'USER_UPDATED'.
 *   - `user` is the normalized `{ id, email }` object, or null when signed out.
 *
 * Returns an unsubscribe function. Call it to remove the listener:
 *   const unsubscribe = onAuthStateChange(callback);
 *   // later:
 *   unsubscribe();
 *
 * NOTE: This function is synchronous in its setup but the callback fires
 * asynchronously. When the Supabase client is not yet configured, a no-op
 * unsubscribe function is returned and the callback is never fired — the
 * finance application continues loading normally.
 *
 * @param {(event: string, user: { id: string, email: string } | null) => void} callback
 * @returns {() => void}  Unsubscribe function.
 */
export function onAuthStateChange(callback) {
  // Return a no-op unsubscribe immediately if not configured.
  // We check synchronously using the already-known placeholder guard.
  if (
    !SUPABASE_CONFIG.url ||
    !SUPABASE_CONFIG.anonKey ||
    SUPABASE_CONFIG.url === 'YOUR_SUPABASE_PROJECT_URL' ||
    SUPABASE_CONFIG.anonKey === 'YOUR_SUPABASE_ANON_KEY'
  ) {
    // Fire the callback with INITIAL_SESSION + null so that app.js (Task 15.8)
    // can safely gate the UI without hanging indefinitely even when Supabase
    // has not been configured yet.
    queueMicrotask(() => callback('INITIAL_SESSION', null));
    return () => {};
  }

  // Lazily obtain the client and wire the listener. We cannot await here
  // because this function must return the unsubscribe handle synchronously.
  // So we set up the subscription asynchronously, keeping a reference to the
  // subscription object once available.
  let subscription = null;
  let cancelled = false;

  getSupabaseClient().then((client) => {
    if (cancelled || !client) {
      if (!client) queueMicrotask(() => callback('INITIAL_SESSION', null));
      return;
    }

    const { data } = client.auth.onAuthStateChange((event, session) => {
      const user = session && session.user ? _normalizeUser(session.user) : null;
      callback(event, user);
    });
    subscription = data.subscription;

    // If unsubscribe was called before the client resolved, unsubscribe now.
    if (cancelled && subscription) {
      subscription.unsubscribe();
    }
  });

  // Return the unsubscribe function. Works before or after the client resolves.
  return function unsubscribe() {
    cancelled = true;
    if (subscription) {
      subscription.unsubscribe();
    }
  };
}

/**
 * Send a password-reset email to the given address.
 *
 * Calls `resetPasswordForEmail` with an optional redirect URL. The redirect
 * URL should point to the change-password page on the deployed application
 * (e.g. the GitHub Pages URL). When `SUPABASE_CONFIG.url` is a placeholder,
 * no redirect URL is derived from it.
 *
 * The password-reset UI (Task 15.6) is responsible for building the redirect
 * URL and may pass it as a second argument; for now a sensible default is
 * derived from `window.location.origin`.
 *
 * @param {string} email
 * @param {string} [redirectTo]  Optional override for the redirect URL.
 * @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>}
 */
export async function resetPassword(email, redirectTo) {
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return { ok: false, error: { code: 'invalid-email', message: 'Email is required.' } };
  }

  const client = await getSupabaseClient();
  if (!client) return _configError();

  // Derive redirect URL from the current page origin when not explicitly
  // provided. This resolves correctly on both localhost and GitHub Pages.
  const redirect =
    typeof redirectTo === 'string' && redirectTo.length > 0
      ? redirectTo
      : (typeof window !== 'undefined' ? window.location.origin : undefined);

  const options = redirect ? { redirectTo: redirect } : {};

  const { error } = await client.auth.resetPasswordForEmail(email.trim(), options);

  if (error) {
    return { ok: false, error: _normalizeError(error) };
  }
  return { ok: true };
}
