/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: reports.service.js
 * Versión: v3.0.0
 * Descripción: Servicio para la gestión de reportes de errores en DB1 (dbEdu).
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { dbEdu, supabaseAdmin, supabase } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [ReportsService-DB1] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error ? error.message : 'Error desconocido'}`, 'ERROR', { ...metadata, stack: error?.stack });
};

/**
 * Registra un nuevo reporte de error en DB1 (dbEdu) bug_reports.
 */
export async function createReport(reportData, userId = null) {
  const title = reportData.title || 'Reporte de error';
  const desc = reportData.description || reportData.user_description || reportData.reason || reportData.error || 'Sin descripción';
  const deviceInfo = reportData.deviceInfo || reportData.device_info || 'AndroidApp';
  const stackTrace = reportData.stackTrace || reportData.stack_trace || reportData.error || '';

  const client = dbEdu || supabaseAdmin || supabase;
  const reportRow = {
    user_description: String(`${title} - ${desc}`).trim(),
    error_log: String(stackTrace).trim(),
    device_info: String(deviceInfo).trim(),
    user_id: userId,
    status: 'pending'
  };

  const { data: dbRecord, error: dbError } = await client
    .from('bug_reports')
    .insert([reportRow])
    .select()
    .single();

  if (dbError) {
    logError('❌ Error al guardar el reporte en Supabase DB1', dbError);
    throw new Error(`Fallo DB al reportar: ${dbError.message}`);
  }

  log(`✅ Reporte guardado en Supabase DB1 (ID: ${dbRecord.id})`, 'INFO');

  // Integración con GitHub opcional
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO = process.env.GITHUB_REPO;

  if (GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO) {
    try {
      const githubBody = `
### Descripción del usuario
${desc}

### Información del Dispositivo
${deviceInfo}

---
**Reporte ID:** ${dbRecord.id}
**Usuario ID:** ${userId || 'Anónimo'}
      `;

      const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: `[REPORT] ${title}`,
          body: githubBody,
          labels: ['bug', 'report']
        })
      });

      const ghData = await response.json();
      if (response.ok) {
        log(`🚀 GitHub Issue creado exitosamente: ${ghData.html_url}`);
        return { success: true, reportId: dbRecord.id, githubUrl: ghData.html_url };
      }
    } catch (ghError) {
      logError('⚠️ Error al crear issue en GitHub', ghError);
    }
  }

  return { success: true, reportId: dbRecord.id, githubUrl: null };
}
