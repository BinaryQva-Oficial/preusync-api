/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: version.service.js
 * Versión: v1.0.0
 * Descripción: Servicio de gestión y consulta de la versión más reciente de la App.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { supabaseAdmin, supabase } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [VersionService] [${level}] ${message}${metaStr}`);
};

/**
 * Consulta la versión más reciente de la aplicación desde Supabase o devuelve el respaldo oficial.
 */
export async function getLatestVersion() {
  try {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('app_versions')
      .select('*')
      .order('version_code', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      log(`✅ Versión recuperada de Supabase: ${data.version_name} (code: ${data.version_code})`);
      return {
        versionCode: data.version_code || 2755,
        versionName: data.version_name || 'v0.99.115 Beta',
        details: data.details || 'Última versión oficial de PreuSync',
        downloadUrl: data.download_url || 'https://preusync.onrender.com'
      };
    }
  } catch (e) {
    log('ℹ️ Usando versión de respaldo por defecto');
  }

  return {
    versionCode: 2755,
    versionName: 'v0.99.115 Beta',
    details: 'Puntos de actualización, resiliencia offline y corrección de votos.',
    downloadUrl: 'https://preusync.onrender.com'
  };
}
