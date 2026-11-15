/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: reports.service.js
 * Versión: v4.0.0
 * Descripción: Servicio de gestión de reportes de errores en DB1 (dbEdu) y
 *              denuncias de publicaciones comunitarias en DB2 (dbCommunity).
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { dbEdu, dbCommunity, dbAuth, supabaseAdmin, supabase } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [ReportsService] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error ? error.message : 'Error desconocido'}`, 'ERROR', { ...metadata, stack: error?.stack });
};

/**
 * Consulta las denuncias de publicaciones comunitarias guardadas en DB2 (dbCommunity).
 */
export async function getPostReports() {
  const clientComm = dbCommunity || supabaseAdmin || supabase;
  const clientAuth = dbAuth || supabaseAdmin || supabase;

  const { data: reports, error } = await clientComm
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    logError('❌ Error al consultar denuncias de posts en DB2', error);
    throw new Error(`Fallo al consultar denuncias: ${error.message}`);
  }

  if (!reports || reports.length === 0) return [];

  const postIds = [...new Set(reports.map(r => r.post_id).filter(Boolean))];
  const reporterIds = [...new Set(reports.map(r => r.reporter_id).filter(Boolean))];

  const postMap = new Map();
  const userMap = new Map();

  if (postIds.length > 0) {
    const { data: posts } = await clientComm
      .from('posts')
      .select('id, title, details, author_id')
      .in('id', postIds);
    if (posts) posts.forEach(p => postMap.set(p.id, p));
  }

  if (reporterIds.length > 0) {
    const { data: users } = await clientAuth
      .from('profiles')
      .select('id, username')
      .in('id', reporterIds);
    if (users) users.forEach(u => userMap.set(u.id, u.username));
  }

  return reports.map(r => {
    const post = postMap.get(r.post_id);
    const reporter = userMap.get(r.reporter_id);
    return {
      id: r.id,
      post_id: r.post_id,
      reporter_id: r.reporter_id,
      reporter_username: reporter || 'Usuario',
      post_title: post ? (post.title || post.details) : 'Publicación de la comunidad',
      reason: r.reason || 'Sin razón especificada',
      created_at: r.created_at
    };
  });
}

/**
 * Elimina/descarta una denuncia de publicación en DB2 (dbCommunity).
 */
export async function deletePostReport(id) {
  const clientComm = dbCommunity || supabaseAdmin || supabase;
  const { error } = await clientComm
    .from('reports')
    .delete()
    .eq('id', id);

  if (error) {
    logError(`❌ Error al descartar denuncia ${id} en DB2`, error);
    throw new Error(`Fallo al descartar denuncia: ${error.message}`);
  }

  return { success: true };
}

/**
 * Consulta la lista de todos los reportes de error guardados en DB1 (dbEdu).
 */
export async function getReports() {
  const client = dbEdu || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('bug_reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    logError('❌ Error al consultar bug_reports en DB1', error);
    throw new Error(`Fallo al consultar reportes: ${error.message}`);
  }

  return data || [];
}

/**
 * Elimina un reporte de error específico en DB1 (dbEdu).
 */
export async function deleteReport(id) {
  const client = dbEdu || supabaseAdmin || supabase;
  const { error } = await client
    .from('bug_reports')
    .delete()
    .eq('id', id);

  if (error) {
    logError(`❌ Error al eliminar reporte ${id} en DB1`, error);
    throw new Error(`Fallo al eliminar reporte: ${error.message}`);
  }

  return { success: true };
}

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
