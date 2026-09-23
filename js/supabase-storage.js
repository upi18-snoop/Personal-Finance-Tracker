/*
 * supabase-storage.js — Supabase database provider for the Personal Finance Tracker.
 *
 * Single responsibility: implement all record-level CRUD operations against the
 * three Supabase PostgreSQL tables (transactions, categories, settings). This is
 * the only file that issues Supabase database queries.
 *
 * Architecture position:
 *   config.js → supabase.js → supabase-storage.js → Supabase PostgreSQL
 *
 * This file is intentionally separate from storage.js. The LocalStorage provider
 * remains fully intact in storage.js; this provider is wired in later (Task 16.5)
 * when authenticated users are present.
 *
 * Layer: Infrastructure / Storage. Imports only supabase.js (the client factory).
 *        Does NOT import auth.js, storage.js, transactions.js, categories.js, or
 *        any UI module. No circular dependencies.
 *
 * Security invariants:
 *   - Every query is scoped by `user_id = userId` (the immutable Supabase UUID).
 *   - No email-based ownership logic.
 *   - No service-role key; no supabase.auth.admin calls.
 *   - All writes explicitly set `user_id: userId` (defence-in-depth alongside RLS).
 *   - Raw Supabase error messages are never surfaced to callers; errors are
 *     normalized to safe codes.
 *   - No localStorage access anywhere in this file.
 */

import { getSupabaseClient } from './supabase.js';

// ---------------------------------------------------------------------------
// SupabaseDatabaseProvider
// ---------------------------------------------------------------------------

/**
 * Async CRUD provider that reads/writes to Supabase PostgreSQL.
 *
 * All methods are async and return either:
 *   - The requested data (for reads)
 *   - `{ ok: true, ... }` on success (for mutations)
 *   - `{ ok: false, error: { code, message } }` on failure
 *
 * Read methods that return arrays degrade gracefully to `[]` on error.
 * `getSettings` degrades to a safe default `{ currency: 'IDR' }` on error.
 */
export class SupabaseDatabaseProvider {
  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Normalize a raw Supabase (or network) error into a safe, internal error
   * object. Never exposes raw DB messages that could leak internals.
   *
   * Recognized codes:
   *   'not-configured'    — getSupabaseClient() returned null (placeholders still in place)
   *   'not-authenticated' — no valid session / RLS rejection
   *   'duplicate'         — UNIQUE constraint violation (Postgres code 23505)
   *   'network-error'     — fetch/CDN failure
   *   'unknown'           — anything else
   *
   * @param {unknown} raw - Raw error from Supabase or a thrown exception.
   * @returns {{ code: string, message: string }}
   */
  _normalizeError(raw) {
    if (!raw) {
      return { code: 'unknown', message: 'An unknown error occurred.' };
    }

    // Postgres UNIQUE violation — supabase-js exposes this as error.code === '23505'
    if (raw.code === '23505') {
      return { code: 'duplicate', message: 'A record with that name already exists.' };
    }

    const msg = typeof raw.message === 'string' ? raw.message.toLowerCase() : '';

    // Network / fetch failures
    if (
      raw.name === 'TypeError' ||
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('load failed')
    ) {
      return { code: 'network-error', message: 'A network error occurred. Please check your connection.' };
    }

    // JWT / auth errors surfaced by the PostgREST layer
    if (
      msg.includes('jwt') ||
      msg.includes('unauthorized') ||
      msg.includes('not authenticated') ||
      raw.status === 401 ||
      raw.status === 403
    ) {
      return { code: 'not-authenticated', message: 'Authentication required.' };
    }

    return { code: 'unknown', message: 'An error occurred. Please try again.' };
  }

  /**
   * Map a raw database row (snake_case) to a camelCase transaction object
   * as the rest of the application expects it. `user_id` and `updated_at` are
   * intentionally omitted from the returned object.
   *
   * DB → JS mapping:
   *   item_name  → itemName
   *   created_at → createdAt
   *   All other fields are identical.
   *
   * @param {object} row - Raw row from the `transactions` table.
   * @returns {object} Camel-case transaction object.
   */
  _rowToTransaction(row) {
    return {
      id:        row.id,
      type:      row.type,
      itemName:  row.item_name,
      amount:    Number(row.amount), // NUMERIC arrives as string from PostgREST
      category:  row.category,
      date:      row.date,
      createdAt: row.created_at,
    };
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  /**
   * Retrieve all transactions for the given user from Supabase.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @returns {Promise<object[]>} Array of camelCase transaction objects, or `[]` on error.
   */
  async getTransactions(userId) {
    const client = await getSupabaseClient();
    if (!client) {
      console.warn('supabase-storage: getTransactions — Supabase is not configured.');
      return [];
    }

    try {
      const { data, error } = await client
        .from('transactions')
        .select('id, item_name, amount, type, category, date, created_at')
        .eq('user_id', userId);

      if (error) {
        console.error('supabase-storage: getTransactions error', error.code ?? '');
        return [];
      }

      return (data ?? []).map((row) => this._rowToTransaction(row));
    } catch (err) {
      console.error('supabase-storage: getTransactions exception', err?.name ?? '');
      return [];
    }
  }

  /**
   * Insert a new transaction row into Supabase for the given user.
   *
   * The caller-supplied `transaction.id` is preserved (client-generated UUID).
   * `updated_at` is handled by the DB default.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @param {object} transaction - Camel-case transaction object (must include `id`, `itemName`, `amount`, `type`, `category`, `date`, `createdAt`).
   * @returns {Promise<{ ok: true, transaction: object } | { ok: false, error: { code: string, message: string } }>}
   */
  async addTransaction(userId, transaction) {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, error: { code: 'not-configured', message: 'Supabase is not configured.' } };
    }

    try {
      const row = {
        id:         transaction.id,
        user_id:    userId,
        item_name:  transaction.itemName,
        amount:     transaction.amount,
        type:       transaction.type,
        category:   transaction.category,
        date:       transaction.date,
        created_at: transaction.createdAt ?? new Date().toISOString(),
      };

      const { data, error } = await client
        .from('transactions')
        .insert(row)
        .select('id, item_name, amount, type, category, date, created_at')
        .single();

      if (error) {
        console.error('supabase-storage: addTransaction error', error.code ?? '');
        return { ok: false, error: this._normalizeError(error) };
      }

      return { ok: true, transaction: this._rowToTransaction(data) };
    } catch (err) {
      console.error('supabase-storage: addTransaction exception', err?.name ?? '');
      return { ok: false, error: this._normalizeError(err) };
    }
  }

  /**
   * Delete a single transaction by ID, scoped to the given user.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @param {string} transactionId - The transaction's `id` value.
   * @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>}
   */
  async deleteTransaction(userId, transactionId) {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, error: { code: 'not-configured', message: 'Supabase is not configured.' } };
    }

    try {
      const { error } = await client
        .from('transactions')
        .delete()
        .eq('id', transactionId)
        .eq('user_id', userId);

      if (error) {
        console.error('supabase-storage: deleteTransaction error', error.code ?? '');
        return { ok: false, error: this._normalizeError(error) };
      }

      return { ok: true };
    } catch (err) {
      console.error('supabase-storage: deleteTransaction exception', err?.name ?? '');
      return { ok: false, error: this._normalizeError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Custom Categories
  // -------------------------------------------------------------------------

  /**
   * Retrieve all custom categories for the given user.
   * Default categories are JavaScript constants and are NOT stored in Supabase.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @returns {Promise<Array<{ name: string, type: string }>>} Array of `{ name, type }` objects, or `[]` on error.
   */
  async getCustomCategories(userId) {
    const client = await getSupabaseClient();
    if (!client) {
      console.warn('supabase-storage: getCustomCategories — Supabase is not configured.');
      return [];
    }

    try {
      const { data, error } = await client
        .from('categories')
        .select('name, type')
        .eq('user_id', userId);

      if (error) {
        console.error('supabase-storage: getCustomCategories error', error.code ?? '');
        return [];
      }

      return (data ?? []).map((row) => ({ name: row.name, type: row.type }));
    } catch (err) {
      console.error('supabase-storage: getCustomCategories exception', err?.name ?? '');
      return [];
    }
  }

  /**
   * Insert a new custom category for the given user.
   *
   * The DB enforces UNIQUE (user_id, name, type); duplicates are returned as
   * `{ ok: false, error: { code: 'duplicate', ... } }`.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @param {{ name: string, type: string }} category - Category descriptor.
   * @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>}
   */
  async addCustomCategory(userId, category) {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, error: { code: 'not-configured', message: 'Supabase is not configured.' } };
    }

    try {
      const { error } = await client
        .from('categories')
        .insert({
          user_id: userId,
          name:    category.name.trim(),
          type:    category.type,
        });

      if (error) {
        console.error('supabase-storage: addCustomCategory error', error.code ?? '');
        return { ok: false, error: this._normalizeError(error) };
      }

      return { ok: true };
    } catch (err) {
      console.error('supabase-storage: addCustomCategory exception', err?.name ?? '');
      return { ok: false, error: this._normalizeError(err) };
    }
  }

  /**
   * Delete a custom category for the given user identified by name and type.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @param {{ name: string, type: string }} category - Category to remove.
   * @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>}
   */
  async deleteCustomCategory(userId, category) {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, error: { code: 'not-configured', message: 'Supabase is not configured.' } };
    }

    try {
      const { error } = await client
        .from('categories')
        .delete()
        .eq('user_id', userId)
        .eq('name', category.name)
        .eq('type', category.type);

      if (error) {
        console.error('supabase-storage: deleteCustomCategory error', error.code ?? '');
        return { ok: false, error: this._normalizeError(error) };
      }

      return { ok: true };
    } catch (err) {
      console.error('supabase-storage: deleteCustomCategory exception', err?.name ?? '');
      return { ok: false, error: this._normalizeError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /**
   * Retrieve the settings row for the given user.
   * Returns `{ currency: 'IDR' }` as a safe default when no row exists or on error.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @returns {Promise<{ currency: string }>} Settings object.
   */
  async getSettings(userId) {
    const DEFAULT_SETTINGS = { currency: 'IDR' };

    const client = await getSupabaseClient();
    if (!client) {
      console.warn('supabase-storage: getSettings — Supabase is not configured.');
      return DEFAULT_SETTINGS;
    }

    try {
      const { data, error } = await client
        .from('settings')
        .select('currency')
        .eq('user_id', userId)
        .maybeSingle(); // returns null (not an error) when no row exists

      if (error) {
        console.error('supabase-storage: getSettings error', error.code ?? '');
        return DEFAULT_SETTINGS;
      }

      if (!data) {
        // No settings row yet — return the safe default.
        return DEFAULT_SETTINGS;
      }

      return { currency: data.currency ?? 'IDR' };
    } catch (err) {
      console.error('supabase-storage: getSettings exception', err?.name ?? '');
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Upsert the settings row for the given user.
   * Uses INSERT … ON CONFLICT (user_id) DO UPDATE so first-time callers
   * create the row and subsequent callers update it.
   *
   * Only the `currency` field is managed for now; additional fields can be
   * added to the upsert payload without changes to the call sites.
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @param {{ currency: string }} settings - Settings to persist.
   * @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>}
   */
  async setSettings(userId, settings) {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, error: { code: 'not-configured', message: 'Supabase is not configured.' } };
    }

    try {
      const { error } = await client
        .from('settings')
        .upsert(
          {
            user_id:    userId,
            currency:   settings.currency,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) {
        console.error('supabase-storage: setSettings error', error.code ?? '');
        return { ok: false, error: this._normalizeError(error) };
      }

      return { ok: true };
    } catch (err) {
      console.error('supabase-storage: setSettings exception', err?.name ?? '');
      return { ok: false, error: this._normalizeError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Ensure a settings row exists for the user with the default currency 'IDR'.
   * Safe to call multiple times — the ON CONFLICT DO NOTHING clause makes it
   * idempotent.
   *
   * Call this once after a user signs in for the first time (before other reads).
   *
   * @param {string} userId - Immutable Supabase user UUID.
   * @returns {Promise<{ ok: true } | { ok: false, error: { code: string, message: string } }>}
   */
  async initializeUserData(userId) {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, error: { code: 'not-configured', message: 'Supabase is not configured.' } };
    }

    try {
      // INSERT ... ON CONFLICT DO NOTHING is idempotent: safe for every login.
      const { error } = await client
        .from('settings')
        .upsert(
          { user_id: userId, currency: 'IDR' },
          { onConflict: 'user_id', ignoreDuplicates: true }
        );

      if (error) {
        console.error('supabase-storage: initializeUserData error', error.code ?? '');
        return { ok: false, error: this._normalizeError(error) };
      }

      return { ok: true };
    } catch (err) {
      console.error('supabase-storage: initializeUserData exception', err?.name ?? '');
      return { ok: false, error: this._normalizeError(err) };
    }
  }
}
