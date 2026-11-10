/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: api.js
 * Versión: v3.1.0
 * Descripción: Enrutador centralizado REST API con endpoints para borrado de posts,
 *              reportes con motivo y consulta pública de perfiles por username.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import express from 'express';
import * as authService from '../services/auth.service.js';
import * as schoolService from '../services/school.service.js';
import * as scheduleService from '../services/schedule.service.js';
import * as postService from '../services/post.service.js';
import * as newsService from '../services/news.service.js';
import * as eventService from '../services/event.service.js';
import * as ephemerisService from '../services/ephemeris.service.js';
import * as voteService from '../services/vote.service.js';
import * as telemetryService from '../services/telemetry.service.js';
import * as versionService from '../services/version.service.js';
import * as reportsService from '../services/reports.service.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';

const router = express.Router();

// --- TELEMETRÍA Y SISTEMA ---
router.get('/ping', (req, res) => {
  res.json({ success: true, message: 'pong', timestamp: new Date().toISOString() });
});

router.get('/admin/telemetry', async (req, res) => {
  try {
    const data = await telemetryService.getTelemetryData();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- AUTENTICACIÓN Y USUARIOS ---
router.post('/auth/signup', async (req, res) => {
  try {
    const data = await authService.signUp(req.body.username, req.body.password, req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const data = await authService.login(req.body.username, req.body.password);
    res.json({ success: true, data });
  } catch (error) {
    const statusCode = (error.message === 'AUTH_USER_NOT_FOUND' || error.message === 'AUTH_INVALID_PASSWORD') ? 401 : 400;
    res.status(statusCode).json({ success: false, error: error.message });
  }
});

router.get('/auth/me', authenticate, async (req, res) => {
  try {
    const data = await authService.getUserByUsername(req.user.user_metadata?.username || req.user.email?.split('@')[0]);
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

router.get('/auth/exists/:username', async (req, res) => {
  try {
    const data = await authService.checkUsernameExists(req.params.username);
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/auth/profile/:username', optionalAuthenticate, async (req, res) => {
  try {
    const data = await authService.getUserByUsername(req.params.username);
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const data = await authService.refreshSession(req.body.refreshToken);
    res.json({ success: true, data });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

router.post('/auth/verify-password', authenticate, async (req, res) => {
  try {
    const data = await authService.verifyPassword(req.user.user_metadata?.username, req.body.password);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/auth/account', authenticate, async (req, res) => {
  try {
    const data = await authService.deleteAccount(req.user.id, req.body.password);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- UBICACIONES Y ESCUELAS ---
router.get('/schools/provinces', async (req, res) => {
  try {
    const data = await schoolService.getProvinces();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/schools/municipalities', async (req, res) => {
  try {
    const data = await schoolService.getMunicipalities(req.query.provinceId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/schools', async (req, res) => {
  try {
    const data = await schoolService.getSchools(req.query.municipalityId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/schools/responsibilities', async (req, res) => {
  try {
    const data = await schoolService.getResponsibilities();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/groups', async (req, res) => {
  try {
    const data = await schoolService.getGroups(req.query.schoolId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- HORARIOS ---
router.get('/schedule', async (req, res) => {
  try {
    const data = await scheduleService.getSchedule(req.query.group, req.query.schoolId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/schedule', authenticate, async (req, res) => {
  try {
    const data = await scheduleService.upsertSchedule(req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- PUBLICACIONES (POSTS) ---
router.get('/posts/top', optionalAuthenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const data = await postService.getTopPosts(limit, req.user?.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/posts/range', async (req, res) => {
  try {
    const data = await postService.getPostsRange(req.query.start, req.query.count, req.user?.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/posts', authenticate, async (req, res) => {
  try {
    const data = await postService.addPost(req.body, req.user.id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/posts/:id', authenticate, async (req, res) => {
  try {
    const data = await postService.deletePost(req.params.id, req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/posts/:id/vote', authenticate, async (req, res) => {
  try {
    const data = await voteService.setVote(req.params.id, req.user.id, req.body.voteType);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/posts/:id/report', authenticate, async (req, res) => {
  try {
    const data = await postService.reportPost(req.params.id, req.user.id, req.body.reason);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/profile/votes', authenticate, async (req, res) => {
  try {
    const data = await voteService.getUserVotes(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- NOTICIAS ---
router.get('/news/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const data = await newsService.getTopNews(limit);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/news/range', async (req, res) => {
  try {
    const data = await newsService.getNewsRange(req.query.start, req.query.count);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/news', authenticate, async (req, res) => {
  try {
    const data = await newsService.addNews(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- EVENTOS ---
router.get('/events/school', async (req, res) => {
  try {
    const data = await eventService.getSchoolEvents(req.query.schoolId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/events/external', async (req, res) => {
  try {
    const data = await eventService.getExternalEvents(req.query.schoolId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/events', authenticate, async (req, res) => {
  try {
    const data = await eventService.addEvent(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- EFEMÉRIDES ---
router.get('/ephemeris', async (req, res) => {
  try {
    const data = await ephemerisService.getEphemeridesByDate(req.query.date);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/ephemeris', authenticate, async (req, res) => {
  try {
    const data = await ephemerisService.addEphemeris(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- REPORTES ---
router.post('/reports', optionalAuthenticate, async (req, res) => {
  try {
    const data = await reportsService.createReport(req.body, req.user?.id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// --- PERFILES DE USUARIO ---
router.get('/profile/posts', authenticate, async (req, res) => {
  try {
    const data = await postService.getPostsByAuthor(req.user.id, req.query.start, req.query.count);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/profile/stats', authenticate, async (req, res) => {
  try {
    const data = await postService.getUserStats(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- VERSIONES ---
router.get('/versions/latest', async (req, res) => {
  try {
    const data = await versionService.getLatestVersion();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
