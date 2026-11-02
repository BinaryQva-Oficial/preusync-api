/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: auth.service.js
 * Versión: v2.3.0
 * Descripción: Servicio de autenticación con detección automática de errores
 *              'fetch failed' / DNS y fallback inmediato a DB1 (Edu).
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { supabase, supabaseAdmin, dbAuth, dbEdu } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [AuthService] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error.message}`, 'ERROR', { ...metadata, stack: error.stack });
};

// ==================== REGISTRO (SIGNUP) ====================

/**
 * Registra un nuevo usuario creando la cuenta en Auth y su perfil en la DB.
 */
export async function signUp(username, password, userData) {
  log(`🔐 Iniciando proceso de registro para: ${username}`);

  let existingUser = null;
  try {
    const res = await dbAuth.from('profiles').select('username').ilike('username', username.trim()).maybeSingle();
    if (res.error && (res.error.message.includes('fetch failed') || res.error.message.includes('ENOTFOUND'))) {
      const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('username').ilike('username', username.trim()).maybeSingle();
      existingUser = fallbackRes.data;
    } else {
      existingUser = res.data;
    }
  } catch (e) {
    const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('username').ilike('username', username.trim()).maybeSingle();
    existingUser = fallbackRes.data;
  }

  if (existingUser) throw new Error('El nombre de usuario ya está en uso');

  if (userData.idCard) {
    let existingId = null;
    try {
      const res = await dbAuth.from('profiles').select('id_card').eq('id_card', userData.idCard).maybeSingle();
      if (!res.error) existingId = res.data;
    } catch (e) {}

    if (existingId) throw new Error('El número de carnet ya está registrado');
  }

  const email = `${username.trim()}@preusync.com`.toLowerCase();
  let authData;

  const metadataPayload = {
    username: username.trim(),
    firstName: userData.firstName || '',
    lastName: userData.lastName || '',
    idCard: userData.idCard || '',
    role: userData.role || 'student',
    schoolId: userData.schoolId || null,
    groupId: userData.groupId || null,
    avatar: userData.avatar || '',
    tutee: userData.tutee || '',
    responsibilities: userData.responsibilities || ''
  };

  const { data: signUpData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadataPayload }
  });

  if (authError) {
    const errText = authError.message ? authError.message.toLowerCase() : '';
    if (errText.includes('already registered') || errText.includes('already exists')) {
      log(`⚠️ El usuario ${username} ya existe en Auth. Probando autenticación para auto-recuperación...`, 'WARN');
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        logError(`❌ Contraseña incorrecta para usuario existente en Auth: ${username}`, signInError);
        throw new Error('El nombre de usuario ya está registrado');
      }
      authData = signInData;
    } else {
      logError(`❌ Fallo en registro de autenticación para ${email}`, authError);
      throw new Error(authError.message);
    }
  } else {
    authData = signUpData;
  }

  const profile = {
    id: authData.user.id,
    username: username.trim(),
    first_name: userData.firstName || '',
    last_name: userData.lastName || '',
    full_name: ((userData.firstName || '').trim() + ' ' + (userData.lastName || '').trim()).trim(),
    id_card: userData.idCard || '',
    role: userData.role || 'student',
    status: 'verified',
    avatar_url: userData.avatar || '',
    school_id: userData.schoolId || null,
    group_id: userData.groupId || null,
    tutee: userData.tutee || '',
    responsibilities: userData.responsibilities || ''
  };

  log(`💾 Insertando/Restaurando perfil para ${username}`, 'INFO', { profile });

  let insertError = null;
  try {
    const res = await dbAuth.from('profiles').upsert(profile);
    if (res.error && (res.error.message.includes('fetch failed') || res.error.message.includes('ENOTFOUND'))) {
      log(`⚠️ dbAuth inalcanzable (${res.error.message}). Ejecutando fallback en DB1 (Edu)...`, 'WARN');
      const fallbackRes = await (supabaseAdmin || supabase).from('profiles').upsert(profile);
      if (fallbackRes.error) insertError = fallbackRes.error;
    } else if (res.error) {
      insertError = res.error;
    }
  } catch (e) {
    log(`⚠️ dbAuth no respondió. Ejecutando fallback en DB1 (Edu)...`, 'WARN');
    const fallbackRes = await (supabaseAdmin || supabase).from('profiles').upsert(profile);
    if (fallbackRes.error) insertError = fallbackRes.error;
  }

  if (insertError) {
    logError(`❌ Error al crear perfil para el usuario: ${authData.user.id}`, insertError);
    throw new Error(`Fallo en la creación del perfil: ${insertError.message}`);
  }

  log(`✅ Usuario ${username} registrado y configurado exitosamente (ID: ${authData.user.id})`, 'INFO');
  return {
    user: authData.user,
    profile,
    sessionToken: authData.session?.access_token || null,
    refreshToken: authData.session?.refresh_token || null
  };
}

// ==================== INICIO DE SESIÓN (LOGIN) ====================

/**
 * Autentica al usuario diferenciando AUTH_USER_NOT_FOUND y AUTH_INVALID_PASSWORD.
 */
export async function login(username, password) {
  log(`🔐 Intento de inicio de sesión: ${username}`);

  let userExists = null;
  try {
    const res = await dbAuth.from('profiles').select('id').ilike('username', username.trim()).maybeSingle();
    if (res.error && (res.error.message.includes('fetch failed') || res.error.message.includes('ENOTFOUND'))) {
      const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('id').ilike('username', username.trim()).maybeSingle();
      userExists = fallbackRes.data;
    } else {
      userExists = res.data;
    }
  } catch (e) {
    const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('id').ilike('username', username.trim()).maybeSingle();
    userExists = fallbackRes.data;
  }

  if (!userExists) {
    log(`⚠️ Intento de login con usuario inexistente: ${username}`, 'WARN');
    throw new Error('AUTH_USER_NOT_FOUND');
  }

  const email = `${username.trim()}@preusync.com`.toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    logError(`❌ Contraseña incorrecta para usuario: ${username}`, error);
    throw new Error('AUTH_INVALID_PASSWORD');
  }

  let profile = null;
  try {
    const res = await dbAuth.from('profiles').select('*').ilike('username', username.trim()).maybeSingle();
    if (res.error && (res.error.message.includes('fetch failed') || res.error.message.includes('ENOTFOUND'))) {
      const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('*').ilike('username', username.trim()).maybeSingle();
      profile = fallbackRes.data;
    } else {
      profile = res.data;
    }
  } catch (e) {
    const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('*').ilike('username', username.trim()).maybeSingle();
    profile = fallbackRes.data;
  }

  if (!profile) {
    log(`⚠️ Perfil faltante para usuario autenticado ${username}. Creando desde metadatos...`, 'WARN');
    const meta = data.user.user_metadata || {};
    const fName = meta.firstName || meta.first_name || username.trim();
    const lName = meta.lastName || meta.last_name || '';

    const fallbackProfile = {
      id: data.user.id,
      username: username.trim(),
      first_name: fName,
      last_name: lName,
      full_name: (fName + ' ' + lName).trim(),
      id_card: meta.idCard || meta.id_card || '',
      role: meta.role || 'student',
      status: 'verified',
      avatar_url: meta.avatar || meta.avatar_url || '',
      school_id: meta.schoolId || meta.school_id || null,
      group_id: meta.groupId || meta.group_id || null,
      tutee: meta.tutee || '',
      responsibilities: meta.responsibilities || ''
    };

    try { await dbAuth.from('profiles').upsert(fallbackProfile); } catch (e) { await (supabaseAdmin || supabase).from('profiles').upsert(fallbackProfile); }
    profile = fallbackProfile;
  }

  if (profile.status === 'banned') {
    log(`⛔ Usuario ${username} está baneado`, 'WARN');
    throw new Error('Esta cuenta ha sido suspendida');
  }

  log(`✅ Usuario ${username} ha iniciado sesión exitosamente (ID: ${data.user.id})`, 'INFO');
  return {
    user: data.user,
    profile,
    sessionToken: data.session.access_token,
    refreshToken: data.session.refresh_token
  };
}

// ==================== PERFILES PÚBLICOS ====================

export async function getUserByUsername(username) {
  log(`👤 Obteniendo perfil público: ${username}`, 'INFO');

  let data = null;
  try {
    const res = await dbAuth.from('profiles').select('*').ilike('username', username).maybeSingle();
    if (res.error && (res.error.message.includes('fetch failed') || res.error.message.includes('ENOTFOUND'))) {
      const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('*').ilike('username', username).maybeSingle();
      data = fallbackRes.data;
    } else {
      data = res.data;
    }
  } catch (e) {
    const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('*').ilike('username', username).maybeSingle();
    data = fallbackRes.data;
  }

  if (!data) {
    throw new Error('Usuario no encontrado');
  }

  return data;
}

// ==================== ACTUALIZACIÓN DE DATOS ====================

export async function updateUser(userId, updateData) {
  log(`📝 Actualizando perfil del usuario: ${userId}`, 'INFO');

  let existing = null;
  try {
    const res = await dbAuth.from('profiles').select('*').eq('id', userId).single();
    if (res.error && (res.error.message.includes('fetch failed') || res.error.message.includes('ENOTFOUND'))) {
      const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('*').eq('id', userId).single();
      existing = fallbackRes.data;
    } else {
      existing = res.data;
    }
  } catch (e) {
    const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('*').eq('id', userId).single();
    existing = fallbackRes.data;
  }

  if (!existing) throw new Error('Perfil no encontrado');

  const allowedFields = ['first_name', 'last_name', 'full_name', 'id_card', 'role', 'school_id', 'group_id', 'tutee', 'responsibilities', 'avatar_url', 'status'];
  const updated = { ...existing };
  allowedFields.forEach(f => { if (updateData[f] !== undefined) updated[f] = updateData[f]; });

  if (updateData.username && updateData.username !== existing.username) {
    const { data: conflict } = await (dbAuth || supabaseAdmin)
      .from('profiles')
      .select('id')
      .ilike('username', updateData.username)
      .maybeSingle();
    if (conflict) throw new Error('El nombre de usuario ya está en uso');
    updated.username = updateData.username;
  }

  if (updateData.first_name !== undefined || updateData.last_name !== undefined) {
    updated.full_name = (updated.first_name || '') + ' ' + (updated.last_name || '');
  }

  try {
    await dbAuth.from('profiles').update(updated).eq('id', userId);
  } catch (e) {
    await (supabaseAdmin || supabase).from('profiles').update(updated).eq('id', userId);
  }

  log(`✅ Perfil actualizado para el usuario: ${userId}`, 'INFO');
  return { success: true, data: updated };
}

// ==================== GESTIÓN DE SESIONES ====================

export async function refreshSession(refreshToken) {
  log('🔄 Renovando sesión...');
  if (!refreshToken) throw new Error('Token de refresco obligatorio');

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) {
    logError('❌ Fallo al renovar sesión', error);
    throw new Error('Sesión expirada o inválida');
  }

  log(`✅ Sesión renovada para el usuario: ${data.user.id}`, 'INFO');
  return {
    user: data.user,
    sessionToken: data.session.access_token,
    refreshToken: data.session.refresh_token
  };
}

export async function logout(userId) {
  log(`🔐 Logout registrado para: ${userId}`, 'INFO');
  return { success: true };
}

export async function verifyPassword(username, password) {
  log(`🔑 Verificando contraseña para: ${username}`, 'INFO');
  const email = `${username}@preusync.com`.toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    log(`❌ Verificación de contraseña fallida para ${username}`, 'WARN');
    return { valid: false };
  }
  log(`✅ Contraseña verificada para ${username}`, 'INFO');
  return { valid: true };
}

export async function checkUsernameExists(username) {
  log(`🔍 Verificando existencia de usuario: ${username}`);
  let data = null;
  try {
    const res = await dbAuth.from('profiles').select('username').ilike('username', username).maybeSingle();
    if (res.error && (res.error.message.includes('fetch failed') || res.error.message.includes('ENOTFOUND'))) {
      const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('username').ilike('username', username).maybeSingle();
      data = fallbackRes.data;
    } else {
      data = res.data;
    }
  } catch (e) {
    const fallbackRes = await (supabaseAdmin || supabase).from('profiles').select('username').ilike('username', username).maybeSingle();
    data = fallbackRes.data;
  }
  return { exists: !!data };
}

// ==================== ELIMINACIÓN DE CUENTA ====================

export async function deleteAccount(userId, password) {
  log(`🗑️ Solicitud de eliminación de cuenta para: ${userId}`, 'WARN');

  const { data: profile, error: fetchError } = await (dbAuth || supabaseAdmin)
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single();

  if (fetchError || !profile) throw new Error('Perfil no encontrado');

  const { valid } = await verifyPassword(profile.username, password);
  if (!valid) throw new Error('Contraseña incorrecta');

  await (dbAuth || supabaseAdmin)
    .from('profiles')
    .delete()
    .eq('id', userId);

  log(`✅ Cuenta eliminada exitosamente para: ${userId}`, 'INFO');
  return { success: true };
}
