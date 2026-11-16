/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: ephemeris.service.js
 * Versión: v3.0.0
 * Descripción: Servicio de gestión de efemérides históricas con resúmenes
 *              livianos para feeds y consulta completa de detalles por ID.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { dbEphemeris } from '../config/supabase.js';
import { uploadImage } from '../utils/storage.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [EphemerisService] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error.message}`, 'ERROR', { ...metadata, stack: error.stack });
};

// ==================== CREACIÓN DE EFEMÉRIDES ====================

export async function addEphemeris(ephemerisData, userId) {
  const required = ['title', 'details', 'day', 'month'];
  for (const field of required) {
    if (ephemerisData[field] === undefined || ephemerisData[field] === null) {
      throw new Error(`Campo obligatorio faltante en efeméride: ${field}`);
    }
  }

  const day = parseInt(ephemerisData.day);
  const month = parseInt(ephemerisData.month);
  if (day < 1 || day > 31) throw new Error('Día debe estar entre 1 y 31');
  if (month < 1 || month > 12) throw new Error('Mes debe estar entre 1 y 12');

  const dateStr = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
  let imageUrl = '';

  if (ephemerisData.imageBase64 && ephemerisData.imageBase64.trim()) {
    try {
      const filePath = `ephemeris/${userId}/${Date.now()}.jpg`;
      imageUrl = await uploadImage(ephemerisData.imageBase64, ephemerisData.mimetype || 'image/jpeg', filePath);
    } catch (err) {
      logError('Fallo al subir imagen de efeméride, continuando sin ella', err);
    }
  }

  const ephemeris = {
    title: ephemerisData.title.trim(),
    details: ephemerisData.details?.trim() || '',
    image_url: imageUrl,
    day,
    month,
    date: dateStr,
    year: ephemerisData.year?.toString().trim() || null,
    importance: parseInt(ephemerisData.importance) || 5
  };

  const { data, error } = await dbEphemeris
    .from('ephemerides')
    .insert(ephemeris)
    .select('id')
    .single();

  if (error) {
    logError(`❌ Error al crear efeméride por usuario: ${userId}`, error);
    throw new Error(`Fallo al añadir efeméride: ${error.message}`);
  }

  log(`✅ Efeméride creada con éxito (ID: ${data.id}) por usuario: ${userId}`, 'INFO');
  return { id: data.id, imageUrl };
}

// ==================== EDICIÓN Y BORRADO ====================

export async function editEphemeris(ephemerisId, userId, updateData) {
  const { error } = await dbEphemeris
    .from('ephemerides')
    .update(updateData)
    .eq('id', ephemerisId);

  if (error) throw new Error('Fallo al actualizar efeméride');
  return { success: true };
}

export async function deleteEphemeris(ephemerisId) {
  const { error } = await dbEphemeris.from('ephemerides').delete().eq('id', ephemerisId);
  if (error) throw new Error('Fallo al eliminar efeméride');
  return { success: true };
}

// ==================== CONSULTAS LIVIANAS PARA FEEDS ====================

export async function getEphemeridesByDate(dateStr, year = null) {
  if (!dateStr || !/^\d{2}\/\d{2}$/.test(dateStr)) {
    throw new Error('Formato de fecha inválido. Use DD/MM');
  }

  let query = dbEphemeris
    .from('ephemerides')
    .select('id, title, image_url, day, month, date, year, importance, created_at')
    .eq('date', dateStr)
    .order('importance', { ascending: false });

  if (year) query = query.eq('year', String(year));

  const { data, error } = await query;
  if (error) throw new Error(`Fallo al recuperar efemérides: ${error.message}`);
  return (data || []).map(row => ({
    id: row.id,
    title: row.title,
    imageUrl: row.image_url,
    day: row.day,
    month: row.month,
    date: row.date,
    year: row.year,
    importance: row.importance,
    createdAt: row.created_at
  }));
}

// ==================== CONSULTA COMPLETA POR ID ====================

export async function getEphemerisById(ephemerisId) {
  const { data, error } = await dbEphemeris
    .from('ephemerides')
    .select('*')
    .eq('id', ephemerisId)
    .single();

  if (error || !data) throw new Error('Efeméride no encontrada');
  return {
    id: data.id,
    title: data.title,
    details: data.details,
    imageUrl: data.image_url,
    day: data.day,
    month: data.month,
    date: data.date,
    year: data.year,
    importance: data.importance,
    createdAt: data.created_at
  };
}
