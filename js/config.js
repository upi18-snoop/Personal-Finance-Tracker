/*
 * config.js — Public Supabase client configuration.
 *
 * Single responsibility: hold the public (non-secret) Supabase project
 * URL and anon/publishable key needed to initialise the Supabase browser
 * client in future phases.
 *
 * Security rules:
 *   - This file contains ONLY the public anon key (safe to commit to GitHub).
 *   - The anon key identifies the project to Supabase but carries no privileges
 *     of its own. Row Level Security (RLS) policies on the database are what
 *     restrict what authenticated and unauthenticated callers can do.
 *   - NEVER place the service_role key, database password, JWT secret, SMTP
 *     credentials, or any other privileged credential in this file or anywhere
 *     else in the client-side codebase.
 *
 * Setup (Phase 15.1 — before running Phase 15.2):
 *   1. Create a Supabase project at https://supabase.com.
 *   2. In Project Settings → API, copy:
 *        - "Project URL"     → replace YOUR_SUPABASE_PROJECT_URL below.
 *        - "anon / public"   → replace YOUR_SUPABASE_ANON_KEY below.
 *   3. Save this file.
 *   4. The application continues to use LocalStorage until Phase 15.2
 *      initialises the Supabase client with these values.
 *
 * This file is intentionally NOT imported by any existing module yet.
 * It is a configuration foundation prepared for Phase 15.2 (auth.js).
 *
 * Layer: Configuration leaf. No business logic, no DOM, no storage.
 *        Importable by any layer that needs the Supabase client config.
 */

/**
 * Public Supabase configuration for the Personal Finance Tracker.
 *
 * Replace the placeholder strings with real values from your Supabase
 * project dashboard (Project Settings → API) before implementing Phase 15.2.
 *
 * @type {{ url: string, anonKey: string }}
 */
export const SUPABASE_CONFIG = {
  /**
   * Your Supabase project URL.
   * Format: https://<project-ref>.supabase.co
   * Found in: Supabase Dashboard → Project Settings → API → Project URL
   *
   * SAFE TO COMMIT — this is a public identifier, not a secret.
   */
  url: 'https://daxblklizvqfhaltnqdx.supabase.co',

  /**
   * Your Supabase anon (publishable) key.
   * Found in: Supabase Dashboard → Project Settings → API → Project API Keys → anon / public
   *
   * SAFE TO COMMIT — this key is designed for client-side use.
   * It has no privileges beyond what RLS policies explicitly allow.
   *
   * NEVER use the service_role key here. The service_role key bypasses
   * all RLS policies and must NEVER appear in any client-side file.
   */
  anonKey: 'sb_publishable_A9J6NfOyPD0xrR3iIgstBw_jlzNiJVB',
};
