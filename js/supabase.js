/*
 * supabase.js — Supabase client singleton factory.
 *
 * Single responsibility: lazily create and return a single shared Supabase
 * client instance for the entire application. All modules that need the
 * Supabase client import `getSupabaseClient` from here instead of
 * instantiating their own clients.
 *
 * Having a single factory prevents duplicate client instances across the
 * auth layer (auth.js) and the future cloud storage layer
 * (SupabaseDatabaseProvider in storage.js, Task 16.4), satisfying the
 * "one Supabase client across the entire application" constraint.
 *
 * Exported API:
 *   getSupabaseClient()   Async. Returns the singleton SupabaseClient, or
 *                         null when config placeholders are still in place
 *                         or when the CDN import fails.
 *
 * Security invariants:
 *   - Only the public anon key from config.js is used — never the
 *     service_role key.
 *   - No credentials are defined in this file.
 *   - This module never reads or writes localStorage for auth data;
 *     supabase-js manages its own session storage internally.
 *
 * Layer: Infrastructure leaf. Imports only config.js. Does not import
 * storage.js, transactions.js, categories.js, auth.js, or any UI module.
 */

import { SUPABASE_CONFIG } from './config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Official supabase-js ESM CDN entry point, pinned to the v2 major version
 * tag so the latest v2 patch is received without accidentally pulling in a
 * v3 breaking change.
 * @type {string}
 */
const SUPABASE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/**
 * Lazily-resolved Supabase client instance.
 * Null until `getSupabaseClient()` successfully initialises it.
 * @type {import('@supabase/supabase-js').SupabaseClient | null}
 */
let _client = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the shared Supabase client singleton.
 *
 * Lazy initialisation: the CDN module is imported on the first call so the
 * application can load and render normally even when config.js still contains
 * placeholder strings — as long as no Supabase-backed operation is actually
 * invoked.
 *
 * Returns `null` in two cases:
 *   1. `SUPABASE_CONFIG.url` or `SUPABASE_CONFIG.anonKey` are still the
 *      placeholder strings — config has not been filled in.
 *   2. The CDN import throws (offline, CSP block, etc.).
 *
 * The caller is responsible for treating a `null` return as "not configured"
 * and surfacing an appropriate error to the user without crashing.
 *
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient | null>}
 */
export async function getSupabaseClient() {
  // Fast path: already initialised.
  if (_client !== null) {
    return _client;
  }

  // Guard: refuse to create a client when config is missing, empty, whitespace-only,
  // or still contains the placeholder strings shipped with the repository.
  // (Req 27.3 — return null without CDN import for any invalid config value.)
  if (
    !SUPABASE_CONFIG.url ||
    !SUPABASE_CONFIG.anonKey ||
    SUPABASE_CONFIG.url.trim() === '' ||
    SUPABASE_CONFIG.anonKey.trim() === '' ||
    SUPABASE_CONFIG.url === 'YOUR_SUPABASE_PROJECT_URL' ||
    SUPABASE_CONFIG.anonKey === 'YOUR_SUPABASE_ANON_KEY'
  ) {
    return null;
  }

  try {
    const { createClient } = await import(SUPABASE_CDN_URL);
    _client = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    return _client;
  } catch (_err) {
    // CDN load failure (offline, CSP block, etc.)
    // SAFE: static message only — does NOT interpolate the error object,
    // SUPABASE_CONFIG.url, or SUPABASE_CONFIG.anonKey. (Req 27.4)
    console.error('supabase.js: failed to load supabase-js from CDN. Check your network connection.');
    return null;
  }
}
