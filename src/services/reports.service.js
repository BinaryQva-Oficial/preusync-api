/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: reports.service.js
 * Versión: v2.0.0
 * Descripción: Servicio para la gestión de reportes de errores y denuncias de posts.
 *              Guarda en la tabla bug_reports con la columna 'error' correcta.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { supabaseAdmin } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [ReportsService] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error.message}`, 'ERROR', { ...metadata, stack: error.stack });
};

/**
 * Registra un nuevo reporte o denuncia en Supabase bug_reports y opcionalmente en GitHub.
 */
export async function createReport(reportData, userId = null) {
  const title = reportData.title || 'Reporte de usuario';
  const desc = reportData.description || reportData.reason || reportData.error || 'Sin descripción';
  const deviceInfo = reportData.deviceInfo || reportData.device_info || 'AndroidApp';
  const stackTrace = reportData.stackTrace || reportData.stack_trace || '';

  // 1. Almacenamiento en Supabase bug_reports usando la columna 'error' real de la tabla
  const reportRow = {
    title: String(title).trim(),
    error: String(desc).trim(),
    device_info: String(deviceInfo).trim(),
    user_id: userId,
    status: 'pending'
  };

  const { data: dbRecord, error: dbError } = await supabaseAdmin
    .from('bug_reports')
    .insert([reportRow])
    .select()
    .single();

  if (dbError) {
    logError('❌ Error al guardar el reporte en Supabase', dbError);
    throw new Error(`Fallo DB al reportar: ${dbError.message}`);
  }

  log(`✅ Reporte/Denuncia guardado en Supabase (ID: ${dbRecord.id})`, 'INFO');

  // 2. Integración con GitHub: Crea un Issue de forma automatizada.
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

### Stack Trace
\`\`\`
${stackTrace || 'No disponible'}
\`\`\`

---
**Reporte ID (Supabase):** ${dbRecord.id}
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
        await supabaseAdmin
          .from('bug_reports')
          .update({ github_issue_url: ghData.html_url, status: 'sent' })
          .eq('id', dbRecord.id);

        return { success: true, reportId: dbRecord.id, githubUrl: ghData.html_url };
      }
    } catch (ghError) {
      logError('⚠️ Error al crear issue en GitHub', ghError);
    }
  }

  return { success: true, reportId: dbRecord.id, githubUrl: null };
}
