/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: auth.service.js
 * Versión: v3.0.0
 * Descripción: Servicio de autenticación aislado 100% exclusivo para dbAuth (DB 3).
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { supabase, dbAuth } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [AuthService-DB3] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error.message}`, 'ERROR', { ...metadata, stack: error.stack });
};

// ==================== REGISTRO (SIGNUP) ====================

/**
 * Registra un nuevo usuario creando la cuenta en Auth y el perfil EXCLUSIVAMENTE en dbAuth (DB 3).
 */
export async function signUp(username, password, userData) {
  log(`🔐 Registro en DB 3 (dbAuth) para: ${username}`);

  // 1. Comprobar unicidad en dbAuth (DB 3)
  const { data: existingUser } = await dbAuth
    .from('profiles')
    .select('username')
    .ilike('username', username.trim())
    .maybeSingle();

  if (existingUser) throw new Error('El nombre de usuario ya está en uso');

  if (userData.idCard) {
    const { data: existingId } = await dbAuth
      .from('profiles')
      .select('id_card')
      .eq('id_card', userData.idCard)
      .maybeSingle();

    if (existingId) throw new Error('El número de carnet ya está registrado');
  }

  const email = `${username.trim()}@preusync.com`.toLowerCase();
  let userId = null;
  let sessionToken = null;
  let refreshToken = null;

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

  // Creación instantánea en GoTrue Auth (0.2s)
  const { data: signUpData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadataPayload }
  });

  if (authError) {
    const errText = authError.message ? authError.message.toLowerCase() : '';
    if (errText.includes('already registered') || errText.includes('already exists')) {
      log(`⚠️ Usuario ${username} ya registrado en Auth. Recuperando sesión...`, 'WARN');
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error('El nombre de usuario ya está registrado');
      userId = signInData.user.id;
      sessionToken = signInData.session.access_token;
      refreshToken = signInData.session.refresh_token;
    } else {
      logError(`❌ Fallo en registro Auth para ${email}`, authError);
      throw new Error(authError.message);
    }
  } else {
    userId = signUpData.user.id;
    sessionToken = signUpData.session?.access_token || null;
    refreshToken = signUpData.session?.refresh_token || null;
  }

  // 2. Guardar perfil STRICTAMENTE en dbAuth (DB 3)
  const profile = {
    id: userId,
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

  log(`💾 Guardando perfil en DB 3 (dbAuth) para ${username}...`, 'INFO');

  const { error: insertError } = await dbAuth.from('profiles').upsert(profile);
  if (insertError) {
    logError(`❌ Error al crear perfil en DB 3 (dbAuth): ${userId}`, insertError);
    throw new Error(`Fallo en la creación del perfil en DB3: ${insertError.message}`);
  }

  log(`✅ Perfil registrado EXCLUSIVAMENTE en DB 3 (dbAuth) para ${username} (ID: ${userId})`, 'INFO');
  return {
    user: { id: userId, email, user_metadata: metadataPayload },
    profile,
    sessionToken,
    refreshToken
  };
}

// ==================== INICIO DE SESIÓN (LOGIN) ====================

export async function login(username, password) {
  log(`🔐 Login en DB 3 (dbAuth) para: ${username}`);

  // 1. Verificación previa de existencia en dbAuth (DB 3)
  const { data: userExists } = await dbAuth
    .from('profiles')
    .select('id')
    .ilike('username', username.trim())
    .maybeSingle();

  if (!userExists) {
    log(`⚠️ Usuario inexistente en DB 3: ${username}`, 'WARN');
    throw new Error('AUTH_USER_NOT_FOUND');
  }

  // 2. Validación con Supabase Auth
  const email = `${username.trim()}@preusync.com`.toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    logError(`❌ Contraseña incorrecta para usuario: ${username}`, error);
    throw new Error('AUTH_INVALID_PASSWORD');
  }

  // 3. Obtener perfil de dbAuth (DB 3)
  let { data: profile } = await dbAuth
    .from('profiles')
    .select('*')
    .ilike('username', username.trim())
    .maybeSingle();

  if (!profile) {
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

    await dbAuth.from('profiles').upsert(fallbackProfile);
    profile = fallbackProfile;
  }

  if (profile.status === 'banned') {
    throw new Error('Esta cuenta ha sido suspendida');
  }

  log(`✅ Login exitoso en DB 3 para ${username}`, 'INFO');
  return {
    user: data.user,
    profile,
    sessionToken: data.session.access_token,
    refreshToken: data.session.refresh_token
  };
}

// ==================== PERFILES PÚBLICOS ====================

export async function getUserByUsername(username) {
  const { data, error } = await dbAuth
    .from('profiles')
    .select('*')
    .ilike('username', username)
    .maybeSingle();

  if (error || !data) throw new Error('Usuario no encontrado');
  return data;
}

// ==================== ACTUALIZACIÓN DE DATOS ====================

export async function updateUser(userId, updateData) {
  const { data: existing, error: fetchError } = await dbAuth
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchError) throw new Error('Perfil no encontrado');

  const allowedFields = ['first_name', 'last_name', 'full_name', 'id_card', 'role', 'school_id', 'group_id', 'tutee', 'responsibilities', 'avatar_url', 'status'];
  const updated = { ...existing };
  allowedFields.forEach(f => { if (updateData[f] !== undefined) updated[f] = updateData[f]; });

  if (updateData.username && updateData.username !== existing.username) {
    const { data: conflict } = await dbAuth
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

  await dbAuth.from('profiles').update(updated).eq('id', userId);

  log(`✅ Perfil actualizado en DB 3 para: ${userId}`, 'INFO');
  return { success: true, data: updated };
}

// ==================== GESTIÓN DE SESIONES ====================

export async function refreshSession(refreshToken) {
  if (!refreshToken) throw new Error('Token de refresco obligatorio');

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw new Error('Sesión expirada o inválida');

  return {
    user: data.user,
    sessionToken: data.session.access_token,
    refreshToken: data.session.refresh_token
  };
}

export async function logout(userId) {
  return { success: true };
}

export async function verifyPassword(username, password) {
  const email = `${username}@preusync.com`.toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { valid: !error };
}

export async function checkUsernameExists(username) {
  const { data } = await dbAuth
    .from('profiles')
    .select('username')
    .ilike('username', username)
    .maybeSingle();

  return { exists: !!data };
}

// ==================== ELIMINACIÓN DE CUENTA ====================

export async function deleteAccount(userId, password) {
  const { data: profile, error: fetchError } = await dbAuth
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single();

  if (fetchError || !profile) throw new Error('Perfil no encontrado');

  const { valid } = await verifyPassword(profile.username, password);
  if (!valid) throw new Error('Contraseña incorrecta');

  await dbAuth.from('profiles').delete().eq('id', userId);

  log(`✅ Cuenta eliminada de DB 3 para: ${userId}`, 'INFO');
  return { success: true };
}
