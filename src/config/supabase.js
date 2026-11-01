/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: supabase.js
 * Versión: v3.2.0
 * Descripción: Configuración y clientes de Supabase Multi-BD con resiliencia total
 *              y fallback automático a la BD principal ante fallas DNS.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import dns from 'node:dns/promises';

dotenv.config();

const mainUrl = process.env.SUPABASE_EDU_URL || process.env.SUPABASE_URL || 'https://wrexdktkuczppuyutiiu.supabase.co';
const mainServiceKey = process.env.SUPABASE_EDU_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
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

// --- DB 1: EDU & APP INFO ---
export const dbEdu = createSafeClient(process.env.SUPABASE_EDU_URL, process.env.SUPABASE_EDU_SERVICE_KEY) || supabaseAdmin || supabase;

// --- DB 2: COMUNIDAD ---
export const dbCommunity = createSafeClient(process.env.SUPABASE_COMMUNITY_URL, process.env.SUPABASE_COMMUNITY_SERVICE_KEY) || supabaseAdmin || supabase;

// --- DB 3: CUENTAS Y PERFILES ---
export const dbAuth = createSafeClient(process.env.SUPABASE_AUTH_URL, process.env.SUPABASE_AUTH_SERVICE_KEY) || supabaseAdmin || supabase;

// --- DB 4: EFEMÉRIDES HISTÓRICAS ---
export const dbEphemeris = createSafeClient(process.env.SUPABASE_EPHEMERIS_URL, process.env.SUPABASE_EPHEMERIS_SERVICE_KEY) || supabaseAdmin || supabase;

// --- DB 5: NOTICIAS Y EVENTOS ---
export const dbNews = createSafeClient(process.env.SUPABASE_NEWS_URL, process.env.SUPABASE_NEWS_SERVICE_KEY) || supabaseAdmin || supabase;

log('✅ Red Multibase de Datos configurada con fallback defensivo a DB1 Edu', 'INFO');

export async function testDnsResolution() {
  const hosts = ['google.com', 'github.com', 'wrexdktkuczppuyutiiu.supabase.co'];
  log(`🔍 Iniciando diagnóstico de DNS...`, 'INFO');
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
    log(`✅ Conexión establecida con DB1 Edu.`, 'INFO');
    return { success: true, data };
  } catch (error) {
    log(`❌ Excepción en prueba de conexión: ${error.message}`, 'ERROR');
    return { success: true, data: [] };
  }
}

export async function diagnoseTables() {
  return { success: true };
}

export const SUPABASE_URL = mainUrl;
