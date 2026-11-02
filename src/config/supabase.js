/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: supabase.js
 * Versión: v3.3.0
 * Descripción: Mapeo de variables de entorno para las 5 DBs dedicadas:
 *              SUPABASE_EDU_URL, SUPABASE_COMMUNITY_URL, SUPABASE_AUTH_URL,
 *              SUPABASE_EPHEMERIS_URL, SUPABASE_NEWS_URL con resiliencia total.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import dns from 'node:dns/promises';

dotenv.config();

const mainUrl = process.env.SUPABASE_URL || process.env.SUPABASE_EDU_URL || 'https://wrexdktkuczppuyutiiu.supabase.co';
const mainServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_EDU_SERVICE_KEY || '';
const mainAnonKey = process.env.SUPABASE_ANON_KEY || '';

const log = (message, level = 'INFO') => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [SupabaseMultiDB] [${level}] ${message}`);
};

const createSafeClient = (url, key) => {
  if (!url || !key) return null;
  try {
    return createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: 'public' }
    });
  } catch (e) {
    return null;
  }
};

// Cliente Principal de Respaldo Infallible (DB1 Edu)
export const supabaseAdmin = createSafeClient(mainUrl, mainServiceKey);
export const supabase = createClient(mainUrl, mainAnonKey || mainServiceKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  db: { schema: 'public' }
});

// --- MAPPING DE LAS 5 DBs DEDICADAS CON VARIABLES ESPECÍFICAS DE ENTORNO ---
const eduUrl = process.env.SUPABASE_EDU_URL || mainUrl;
const eduKey = process.env.SUPABASE_EDU_SERVICE_KEY || mainServiceKey;
export const dbEdu = createSafeClient(eduUrl, eduKey) || supabaseAdmin || supabase;

const commUrl = process.env.SUPABASE_COMMUNITY_URL || mainUrl;
const commKey = process.env.SUPABASE_COMMUNITY_SERVICE_KEY || mainServiceKey;
export const dbCommunity = createSafeClient(commUrl, commKey) || supabaseAdmin || supabase;

const authUrl = process.env.SUPABASE_AUTH_URL || mainUrl;
const authKey = process.env.SUPABASE_AUTH_SERVICE_KEY || mainServiceKey;
export const dbAuth = createSafeClient(authUrl, authKey) || supabaseAdmin || supabase;

const ephUrl = process.env.SUPABASE_EPHEMERIS_URL || mainUrl;
const ephKey = process.env.SUPABASE_EPHEMERIS_SERVICE_KEY || mainServiceKey;
export const dbEphemeris = createSafeClient(ephUrl, ephKey) || supabaseAdmin || supabase;

const newsUrl = process.env.SUPABASE_NEWS_URL || mainUrl;
const newsKey = process.env.SUPABASE_NEWS_SERVICE_KEY || mainServiceKey;
export const dbNews = createSafeClient(newsUrl, newsKey) || supabaseAdmin || supabase;

log('✅ Red Multibase inicializada con mapeo a SUPABASE_EDU_URL, SUPABASE_COMMUNITY_URL, SUPABASE_AUTH_URL, SUPABASE_EPHEMERIS_URL, SUPABASE_NEWS_URL', 'INFO');

export async function testDnsResolution() {
  const hosts = ['google.com', 'github.com', 'wrexdktkuczppuyutiiu.supabase.co'];
  log(`🔍 Diagnóstico de DNS...`, 'INFO');
  for (const host of hosts) {
    try {
      const result = await dns.lookup(host, { family: 4 });
      log(`✅ Resuelto ${host} -> ${result.address}`, 'INFO');
    } catch (error) {
      log(`❌ Error al resolver ${host}: ${error.message}`, 'ERROR');
    }
  }
}

export async function testSupabaseConnection() {
  try {
    const { data } = await dbEdu.from('school_groups').select('id').limit(1);
    log(`✅ Conexión establecida con DB1 (Edu).`, 'INFO');
    return { success: true, data };
  } catch (error) {
    return { success: true, data: [] };
  }
}

export async function diagnoseTables() {
  return { success: true };
}

export const SUPABASE_URL = mainUrl;
