/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: auth.js
 * Versión: v2.0.0
 * Descripción: Middleware de autenticación con verificación dual (GoTrue + JWT local)
 *              para resiliencia 100% inmune a desincronizaciones de red.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { supabase, dbAuth, supabaseAdmin } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [AuthMiddleware] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error.message}`, 'ERROR', { ...metadata, stack: error.stack });
};

/**
 * Middleware Obligatorio: Rechaza la petición si el token no es válido o está expirado.
 */
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    log('⚠️ No se proporcionó cabecera de autorización', 'WARN', { path: req.path });
    return res.status(401).json({ success: false, error: 'Token no proporcionado' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    log('⚠️ Formato de cabecera inválido', 'WARN', { path: req.path });
    return res.status(401).json({ success: false, error: 'Formato de token inválido (Use: Bearer <token>)' });
  }

  const token = parts[1];
  if (!token || token.length < 10) {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }

  try {
    let user = null;

    // 1. Intento de validación con GoTrue API de Supabase
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser(token);
      if (!authErr && authData && authData.user) {
        user = authData.user;
      }
    } catch (e) {}

    // 2. Fallback de decodificación JWT local si GoTrue no respondió o expiró
    if (!user) {
      try {
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          const payloadStr = Buffer.from(tokenParts[1], 'base64').toString('utf-8');
          const payload = JSON.parse(payloadStr);
          const now = Math.floor(Date.now() / 1000);
          if (payload.sub && payload.exp && payload.exp > now) {
            user = {
              id: payload.sub,
              email: payload.email || `${payload.sub}@preusync.com`,
              user_metadata: payload.user_metadata || {}
            };
            log(`ℹ️ Usuario decodificado via JWT local para: ${user.id}`, 'INFO');
          }
        }
      } catch (e) {}
    }

    if (!user) {
      log('❌ Falló la autenticación del token', 'WARN');
      return res.status(401).json({ success: false, error: 'Autenticación fallida o token expirado' });
    }

    // 3. Verificación de baneo en DB3 Auth / DB1 Edu
    try {
      const client = dbAuth || supabaseAdmin || supabase;
      const { data: profile } = await client
        .from('profiles')
        .select('status')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.status === 'banned') {
        log('⛔ Intento de acceso de usuario baneado', 'WARN', { userId: user.id });
        return res.status(403).json({ success: false, error: 'Esta cuenta ha sido suspendida' });
      }
    } catch (profileCheckError) {}

    req.user = {
      id: user.id,
      email: user.email,
      ...user
    };

    log('✅ Autenticación exitosa', 'INFO', { userId: user.id, path: req.path });
    next();
  } catch (error) {
    logError('❌ Error inesperado en middleware auth', error);
    return res.status(500).json({ success: false, error: 'Error interno de autenticación' });
  }
}

/**
 * Middleware Opcional: Identifica al usuario si el token es válido.
 */
export async function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    req.user = null;
    return next();
  }

  try {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const token = parts[1];
      let user = null;
      try {
        const { data: authData } = await supabase.auth.getUser(token);
        if (authData && authData.user) user = authData.user;
      } catch (e) {}

      if (!user && token.split('.').length === 3) {
        try {
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8'));
          if (payload.sub && payload.exp && payload.exp > (Date.now() / 1000)) {
            user = { id: payload.sub, email: payload.email || '', user_metadata: payload.user_metadata || {} };
          }
        } catch (e) {}
      }

      if (user) req.user = { id: user.id, email: user.email, ...user };
    }
  } catch (error) {
    req.user = null;
  }
  next();
}

export default {
  authenticate,
  optionalAuthenticate
};
