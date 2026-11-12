/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: auth.service.js
 * Versión: v3.0.0
 * Descripción: Servicio de autenticación y gestión de usuarios en DB3 Auth con
 *              resolución enriquecida de escuela, municipio y provincia desde DB1 Edu.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { supabase, dbAuth, dbEdu, supabaseAdmin } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [AuthService] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error ? error.message : 'Error desconocido'}`, 'ERROR', { ...metadata, stack: error?.stack });
};

// ==================== OPERACIONES DE REGISTRO E INGRESO ====================

export async function signUp(username, password, extraData = {}) {
  if (!username || !password) throw new Error('Se requiere usuario y contraseña');

  const clientAuth = dbAuth || supabaseAdmin || supabase;
  const { data: existing } = await clientAuth
    .from('profiles')
    .select('id')
    .ilike('username', username)
    .maybeSingle();

  if (existing) throw new Error('El nombre de usuario ya está registrado');

  const email = extraData.email || `${username.toLowerCase().trim()}@preusync.com`;
  const fullName = `${extraData.firstName || ''} ${extraData.lastName || ''}`.trim() || username;

  let authUser = null;
  let sessionToken = '';
  let refreshToken = '';

  try {
    const { data: adminData, error: adminErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        firstName: extraData.firstName || '',
        lastName: extraData.lastName || '',
        idCard: extraData.idCard || '',
        role: extraData.role || 'student',
        schoolId: extraData.schoolId || '',
        groupId: extraData.groupId || '',
        tutee: extraData.tutee || '',
        responsibilities: extraData.responsibilities || '',
        avatar: extraData.avatar || ''
      }
    });

    if (adminErr) throw adminErr;
    authUser = adminData.user;

    const { data: loginData } = await supabase.auth.signInWithPassword({ email, password });
    if (loginData && loginData.session) {
      sessionToken = loginData.session.access_token;
      refreshToken = loginData.session.refresh_token;
    }
  } catch (err) {
    logError('Error al crear usuario en Supabase Auth', err);
    throw new Error(`Fallo al registrar usuario: ${err.message}`);
  }

  const profileRow = {
    id: authUser.id,
    username: username.trim(),
    first_name: extraData.firstName || '',
    last_name: extraData.lastName || '',
    full_name: fullName,
    id_card: extraData.idCard || '',
    role: extraData.role || 'student',
    status: 'verified',
    avatar_url: extraData.avatar || '',
    school_id: extraData.schoolId || '',
    group_id: extraData.groupId || '',
    tutee: extraData.tutee || '',
    responsibilities: extraData.responsibilities || ''
  };

  const { error: profErr } = await clientAuth.from('profiles').insert(profileRow);
  if (profErr) {
    logError('Error al crear perfil en DB3', profErr);
    await clientAuth.from('profiles').upsert(profileRow);
  }

  log(`✅ Usuario ${username} registrado exitosamente con ID: ${authUser.id}`, 'INFO');

  return {
    user: authUser,
    profile: profileRow,
    sessionToken,
    refreshToken
  };
}

export async function login(username, password) {
  if (!username || !password) throw new Error('Se requiere usuario y contraseña');

  const clientAuth = dbAuth || supabaseAdmin || supabase;
  const { data: profile } = await clientAuth
    .from('profiles')
    .select('*')
    .ilike('username', username)
    .maybeSingle();

  if (!profile) throw new Error('AUTH_USER_NOT_FOUND');

  const email = `${username.toLowerCase().trim()}@preusync.com`;
  const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });

  if (loginErr) throw new Error('AUTH_INVALID_PASSWORD');

  const enrichedProfile = await getUserByUsername(username);

  return {
    user: loginData.user,
    profile: enrichedProfile,
    sessionToken: loginData.session.access_token,
    refreshToken: loginData.session.refresh_token
  };
}

// ==================== PERFILES PÚBLICOS ENRIQUECIDOS ====================

export async function getUserByUsername(username) {
  const clientAuth = dbAuth || supabaseAdmin || supabase;
  const { data, error } = await clientAuth
    .from('profiles')
    .select('*')
    .ilike('username', username)
    .maybeSingle();

  if (error || !data) throw new Error('Usuario no encontrado');

  // FIX PERFIL: Resolver nombres reales de escuela, municipio, provincia y grupo desde DB1 (dbEdu)
  const clientEdu = dbEdu || supabaseAdmin || supabase;
  let schoolName = '';
  let munName = '';
  let provName = '';
  let groupName = data.group || '';

  if (data.school_id) {
    try {
      const { data: schools } = await clientEdu
        .from('schools')
        .select('name, municipality_id')
        .eq('id', data.school_id)
        .maybeSingle();

      if (schools) {
        schoolName = schools.name || '';
        if (schools.municipality_id) {
          const { data: muns } = await clientEdu
            .from('municipalities')
            .select('name, province_id')
            .eq('id', schools.municipality_id)
            .maybeSingle();

          if (muns) {
            munName = muns.name || '';
            if (muns.province_id) {
              const { data: provs } = await clientEdu
                .from('provinces')
                .select('name')
                .eq('id', muns.province_id)
                .maybeSingle();

              if (provs) provName = provs.name || '';
            }
          }
        }
      }
    } catch (e) {}
  }

  if (data.group_id && !groupName) {
    try {
      const { data: grp } = await clientEdu
        .from('school_groups')
        .select('name')
        .eq('id', data.group_id)
        .maybeSingle();
      if (grp) groupName = grp.name || '';
    } catch (e) {}
  }

  return {
    ...data,
    school: schoolName || data.school || '',
    municipality: munName || data.municipality || '',
    province: provName || data.province || '',
    group: groupName || data.group || ''
  };
}

// ==================== ACTUALIZACIÓN DE DATOS ====================

export async function updateUser(userId, updateData) {
  const clientAuth = dbAuth || supabaseAdmin || supabase;
  const { data: existing, error: fetchError } = await clientAuth
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchError) throw new Error('Perfil no encontrado');

  const allowedFields = ['first_name', 'last_name', 'full_name', 'id_card', 'role', 'school_id', 'group_id', 'tutee', 'responsibilities', 'avatar_url', 'status'];
  const updated = { ...existing };
  allowedFields.forEach(f => { if (updateData[f] !== undefined) updated[f] = updateData[f]; });

  if (updateData.username && updateData.username !== existing.username) {
    const { data: conflict } = await clientAuth
      .from('profiles')
      .select('id')
      .ilike('username', updateData.username)
      .maybeSingle();
    if (conflict) throw new Error('El nombre de usuario ya está en uso');
    updated.username = updateData.username;
  }

  if (updateData.first_name !== undefined || updateData.last_name !== undefined) {
    updated.full_name = `${updated.first_name || ''} ${updated.last_name || ''}`.trim();
  }

  await clientAuth.from('profiles').update(updated).eq('id', userId);

  log(`✅ Perfil actualizado en DB 3 para: ${userId}`, 'INFO');
  const enriched = await getUserByUsername(updated.username);
  return { success: true, data: enriched };
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

export async function checkUsernameExists(username) {
  const clientAuth = dbAuth || supabaseAdmin || supabase;
  const { data } = await clientAuth
    .from('profiles')
    .select('id')
    .ilike('username', username)
    .maybeSingle();

  return { exists: !!data };
}

export async function verifyPassword(username, password) {
  const email = `${username.toLowerCase().trim()}@preusync.com`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error('Contraseña incorrecta');
  return true;
}

export async function deleteAccount(userId, password) {
  const clientAuth = dbAuth || supabaseAdmin || supabase;
  const { data: profile } = await clientAuth
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single();

  if (!profile) throw new Error('Usuario no encontrado');
  await verifyPassword(profile.username, password);

  await clientAuth.from('profiles').delete().eq('id', userId);
  await supabaseAdmin.auth.admin.deleteUser(userId);

  return { success: true };
}
