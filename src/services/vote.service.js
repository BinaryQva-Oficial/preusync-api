/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: vote.service.js
 * Versión: v2.5.0
 * Descripción: Servicio de interacción mediante votos (likes/dislikes) en dbCommunity
 *              con cálculo atómico directo, actualización de la tabla posts y
 *              respuesta exacta con contadores recalculados.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { dbCommunity, supabaseAdmin, supabase } from '../config/supabase.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [VoteService-DB2] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error ? error.message : 'Error desconocido'}`, 'ERROR', { ...metadata, stack: error?.stack });
};

/**
 * Normaliza el tipo de voto a 'like', 'dislike' o 'none'.
 */
function normalizeVoteType(type) {
  if (type === 1 || type === '1' || type === 'up' || type === 'like') return 'like';
  if (type === 2 || type === '2' || type === 'down' || type === 'dislike') return 'dislike';
  return 'none';
}

// ==================== ACCIONES DE VOTO ====================

/**
 * Registra o actualiza el voto de un usuario en una publicación.
 */
export async function setVote(postId, userId, rawVoteType) {
  if (!postId || !userId) throw new Error('Se requiere ID de post y de usuario');

  const voteType = normalizeVoteType(rawVoteType);
  log(`🗳️ Procesando voto '${voteType}' (recibido: '${rawVoteType}') en post ${postId} por usuario ${userId}`);

  const client = dbCommunity || supabaseAdmin || supabase;

  // 1. Comprobación de seguridad: No se permite votar en publicaciones propias
  const { data: post, error: postError } = await client
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .maybeSingle();

  if (postError || !post) {
    logError(`❌ Publicación no encontrada en DB2 (${postId})`, postError);
    throw new Error('Publicación no encontrada');
  }

  if (post.author_id === userId) {
    log(`⛔ Intento de autovoto por usuario ${userId} en su propio post ${postId}`, 'WARN');
    throw new Error('No puedes votar en tus propias publicaciones');
  }

  // 2. Registrar o eliminar el voto en la tabla 'votes' de dbCommunity
  if (voteType === 'none') {
    await client.from('votes').delete().eq('post_id', postId).eq('user_id', userId);
  } else {
    const intVoteType = voteType === 'like' ? 1 : 2;
    // Intentar upsert o update/insert
    const { data: existingVote } = await client
      .from('votes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingVote) {
      await client.from('votes').update({ vote_type: intVoteType }).eq('id', existingVote.id);
    } else {
      await client.from('votes').insert({ post_id: postId, user_id: userId, vote_type: intVoteType });
    }
  }

  // 3. Recalcular las sumas reales de likes y dislikes desde la tabla 'votes'
  const { data: allVotes } = await client
    .from('votes')
    .select('vote_type')
    .eq('post_id', postId);

  let likes = 0;
  let dislikes = 0;

  if (allVotes && Array.isArray(allVotes)) {
    for (const v of allVotes) {
      const vt = String(v.vote_type).toLowerCase();
      if (vt === '1' || vt === 'like' || vt === 'up') likes++;
      else if (vt === '2' || vt === 'dislike' || vt === 'down') dislikes++;
    }
  }

  // 4. Actualizar atómicamente la tabla 'posts' en dbCommunity
  await client
    .from('posts')
    .update({ likes, dislikes, score: likes - dislikes })
    .eq('id', postId);

  log(`✅ Voto '${voteType}' procesado y recalculado en DB2 para post ${postId}. Recuento real -> Likes: ${likes}, Dislikes: ${dislikes}`, 'INFO');

  return {
    voteType,
    likes,
    dislikes
  };
}

// ==================== CONSULTAS DE VOTOS ====================

export async function getUserVote(postId, userId) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('votes')
    .select('vote_type')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Fallo al consultar voto: ${error.message}`);

  if (data) {
    const vt = String(data.vote_type).toLowerCase();
    if (vt === '1' || vt === 'like' || vt === 'up') return 'like';
    if (vt === '2' || vt === 'dislike' || vt === 'down') return 'dislike';
  }
  return 'none';
}

export async function getUserVotes(userId) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('votes')
    .select('post_id, vote_type')
    .eq('user_id', userId);

  if (error) throw new Error(`Fallo al obtener historial de votos: ${error.message}`);
  return data;
}

export async function getPostVoteCounts(postId) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('posts')
    .select('likes, dislikes')
    .eq('id', postId)
    .single();

  if (error) throw new Error(`Fallo al obtener contadores: ${error.message}`);
  return { likes: data.likes || 0, dislikes: data.dislikes || 0 };
}
