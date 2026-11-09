/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: api.js
 * Versión: v1.1.0
 * Descripción: Definición de todas las rutas de la API REST.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import express from 'express';
import * as authService from '../services/auth.service.js';
import * as postService from '../services/post.service.js';
import * as voteService from '../services/vote.service.js';
import * as newsService from '../services/news.service.js';
import * as eventService from '../services/event.service.js';
import * as scheduleService from '../services/schedule.service.js';
import * as ephemerisService from '../services/ephemeris.service.js';
import * as reportsService from '../services/reports.service.js';
import * as schoolService from '../services/school.service.js';
import * as telemetryService from '../services/telemetry.service.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import { supabase, supabaseAdmin, dbEdu, dbCommunity, dbAuth, dbEphemeris, dbNews } from '../config/supabase.js';

const router = express.Router();

// Logger local.
const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [API] [${level}] ${message}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error.message}`, 'ERROR');
};

router.get('/ping', (req, res) => res.json({ message: 'pong' }));

// --- TELEMETRÍA Y MONITOREO REAL ---
router.get('/admin/telemetry', async (req, res) => {
  try {
    const data = await telemetryService.getTelemetryData();
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// --- VERSIONES ---
router.get('/version/latest', optionalAuthenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('app_versions').select('*').order('version_code', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// --- AUTH ---
router.post('/auth/signup', async (req, res) => {
  log(`📝 Petición de registro recibida: ${req.body.username}`, 'INFO', { body: req.body });
  try {
    const result = await authService.signUp(req.body.username, req.body.password, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    logError(`❌ Fallo en el registro: ${req.body.username}`, error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const result = await authService.login(req.body.username, req.body.password);
    res.json({ success: true, data: result });
  } catch (error) {
    let status = error.message === 'Usuario no encontrado' ? 404 : 401;
    res.status(status).json({ success: false, error: error.message });
  }
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const result = await authService.refreshSession(req.body.refreshToken);
    res.json({ success: true, data: result });
  } catch (error) { res.status(401).json({ success: false, error: error.message }); }
});

router.post('/auth/logout', authenticate, async (req, res) => {
  try { await authService.logout(req.user.id); res.json({ success: true }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/auth/me', authenticate, async (req, res) => {
  try {
    log(`🔍 GET /auth/me para req.user.id: ${req.user.id}`, 'INFO');
    const db = dbAuth || supabaseAdmin || supabase;

    let { data, error } = await db
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      logError(`❌ Error de DB en /auth/me para ${req.user.id}`, error);
      throw error;
    }

    // Fallback: Buscar por username si no se encuentra por id de Auth
    if (!data && req.user.email && req.user.email.includes('@')) {
      const username = req.user.email.split('@')[0];
      log(`⚠️ Perfil no encontrado por ID (${req.user.id}). Buscando por username: ${username}`, 'WARN');
      const fallbackQuery = await db
        .from('profiles')
        .select('*')
        .ilike('username', username)
        .maybeSingle();

      if (fallbackQuery.data) {
        data = fallbackQuery.data;
        if (data.id !== req.user.id) {
          await db.from('profiles').update({ id: req.user.id }).eq('id', data.id);
        }
      }
    }

    if (!data) {
      log(`❌ Perfil no encontrado en DB para usuario ${req.user.id}`, 'WARN');
      return res.status(404).json({ success: false, error: 'Perfil no encontrado' });
    }

    // Enriquecimiento de escuela, municipio y provincia desde dbEdu (DB 1)
    if (data.school_id) {
      try {
        const { data: schoolData } = await dbEdu
          .from('schools')
          .select('name, municipalities(name, provinces(name))')
          .eq('id', data.school_id)
          .maybeSingle();

        if (schoolData) {
          data.school = schoolData.name || '';
          if (schoolData.municipalities) {
            data.municipality = schoolData.municipalities.name || '';
            if (schoolData.municipalities.provinces) {
              data.province = schoolData.municipalities.provinces.name || '';
            }
          }
        }
      } catch (schErr) {
        logError('Error al enriquecer datos de escuela', schErr);
      }
    }

    // Enriquecimiento del grupo escolar desde dbEdu (DB 1)
    if (data.group_id) {
      try {
        const { data: groupData } = await dbEdu
          .from('school_groups')
          .select('name')
          .eq('id', data.group_id)
          .maybeSingle();

        if (groupData) {
          data.group = groupData.name || '';
        }
      } catch (grpErr) {
        logError('Error al enriquecer datos de grupo', grpErr);
      }
    }

    log(`✅ Perfil recuperado exitosamente para: ${data.username}`, 'INFO');
    res.json({ success: true, user: req.user, data: data, profile: data });
  } catch (error) {
    logError('❌ Excepción en /auth/me', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- PERFIL Y PUBLICACIONES PERSONALES ---
router.get('/profile/posts', authenticate, async (req, res) => {
  try {
    const start = parseInt(req.query.start) || 0;
    const count = parseInt(req.query.count) || 10;
    const data = await postService.getPostsByAuthor(req.user.id, start, count);
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/profile/stats', authenticate, async (req, res) => {
  try {
    const data = await postService.getUserStats(req.user.id);
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.put('/auth/me', authenticate, async (req, res) => {
  try { const result = await authService.updateUser(req.user.id, req.body); res.json({ success: true, data: result }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/auth/exists/:username', async (req, res) => {
  try { const result = await authService.checkUsernameExists(req.params.username); res.json({ success: true, ...result }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/users/by-username/:username', authenticate, async (req, res) => {
  try { const data = await authService.getUserByUsername(req.params.username); res.json({ success: true, data }); }
  catch (error) { res.status(404).json({ success: false, error: error.message }); }
});

router.put('/users/:id/role', authenticate, async (req, res) => {
  try { const data = await authService.updateUser(req.params.id, req.body); res.json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// --- POSTS ---
router.get('/posts/top', optionalAuthenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const data = await postService.getTopPosts(limit, req.user?.id);
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/posts/range', async (req, res) => {
  try { const data = await postService.getPostsRange(req.query.start, req.query.count, req.user?.id); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/posts', authenticate, async (req, res) => {
  try { const data = await postService.addPost(req.body, req.user.id); res.status(201).json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/posts/:id/vote', authenticate, async (req, res) => {
  try { const data = await voteService.setVote(req.params.id, req.user.id, req.body.voteType); res.json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/profile/votes', authenticate, async (req, res) => {
  try {
    const data = await voteService.getUserVotes(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- NEWS ---
router.get('/news/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const data = await newsService.getTopNews(limit);
    res.json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/news/range', async (req, res) => {
  try { const data = await newsService.getNewsRange(req.query.start, req.query.count); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/news', authenticate, async (req, res) => {
  try { const data = await newsService.addNews(req.body, req.user.id); res.status(201).json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// --- EVENTS ---
router.get('/events/school', async (req, res) => {
  try { const data = await eventService.getEventsRange('school', req.query.start, req.query.count, req.query.schoolId); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/events/external', async (req, res) => {
  try { const data = await eventService.getEventsRange('external', req.query.start, req.query.count); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/events', authenticate, async (req, res) => {
  try { const data = await eventService.addEvent(req.body, req.user.id); res.status(201).json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// --- EPHEMERIS ---
router.get('/ephemeris', async (req, res) => {
  try { const data = await ephemerisService.getEphemeridesByDate(req.query.date, req.query.year); res.json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.post('/ephemeris', authenticate, async (req, res) => {
  try { const data = await ephemerisService.addEphemeris(req.body, req.user.id); res.status(201).json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.delete('/ephemeris/:id', authenticate, async (req, res) => {
  try { const data = await ephemerisService.deleteEphemeris(req.params.id, req.user.id); res.json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// --- SCHEDULE ---
router.get('/schedule', async (req, res) => {
  try { const data = await scheduleService.getSchedule(req.query.group, req.query.schoolId); res.json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

/**
 * Obtiene la lista de todos los grupos registrados en una escuela.
 */
router.get('/groups', async (req, res) => {
  const { schoolId } = req.query;
  try {
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'ID de escuela obligatorio' });
    }
    const data = await schoolService.getGroups(schoolId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- NACIONAL ---
router.get('/schools/provinces', async (req, res) => {
  try { const data = await schoolService.getProvinces(); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/schools/municipalities', async (req, res) => {
  try { const data = await schoolService.getMunicipalities(req.query.provinceId); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/schools/institutions', async (req, res) => {
  try { const data = await schoolService.getSchools(req.query.municipalityId); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/schools/responsibilities', async (req, res) => {
  try { const data = await schoolService.getResponsibilities(); res.json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// --- EPHEMERIS ---
router.get('/ephemeris', async (req, res) => {
  try { const data = await ephemerisService.getEphemeridesByDate(req.query.date, req.query.year); res.json({ success: true, data }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

// --- REPORTS ---
router.post('/reports', optionalAuthenticate, async (req, res) => {
  try { const data = await reportsService.createReport(req.body, req.user?.id); res.status(201).json({ success: true, data }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

export default router;
