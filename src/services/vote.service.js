/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: vote.service.js
 * Versión: v2.0.0
 * Descripción: Servicio de interacción mediante votos (likes/dislikes) en dbCommunity
 *              con normalización flexible de voteType (1/2/0, up/down/none, like/dislike/none).
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
  log(`${message}: ${error.message}`, 'ERROR', { ...metadata, stack: error.stack });
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
    .select('author_id, author')
    .eq('id', postId)
    .single();

  if (postError || !post) throw new Error('Publicación no encontrada');
  if (post.author_id === userId) throw new Error('No puedes votar en tus propias publicaciones');

  // 2. Ejecutar la función RPC de votación en dbCommunity
  const { data, error } = await client.rpc('handle_vote', {
    p_post_id: postId,
    p_user_id: userId,
    p_vote_type: voteType
  });

  if (error) {
    logError(`⚠️ Fallo en RPC 'handle_vote' para el post ${postId}, aplicando fallback directo...`, error);
    await client.from('votes').upsert({ post_id: postId, user_id: userId, vote_type: voteType });
  }

  // 3. Consultar los contadores actualizados de likes/dislikes
  const { data: updatedPost } = await client
    .from('posts')
    .select('likes, dislikes')
    .eq('id', postId)
    .single();

  const likes = updatedPost?.likes || 0;
  const dislikes = updatedPost?.dislikes || 0;

  log(`✅ Voto '${voteType}' registrado exitosamente en post ${postId}. Likes: ${likes}, Dislikes: ${dislikes}`, 'INFO');

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
  return data?.vote_type || 'none';
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
