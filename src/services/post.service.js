/**
 * ============================================================================
 * Proyecto: PreuSync API
 * Archivo: post.service.js
 * Versión: v3.2.0
 * Descripción: Servicio de gestión de publicaciones con resolución enriquecida
 *              multibase (DB2 Community <-> DB3 Auth) para nombres de usuario,
 *              avatares y estado exacto de userVote por usuario.
 * Autor: JiroxDEV
 * Licensed under the GNU Affero General Public License v3
 * ============================================================================
 */

import { dbCommunity, dbAuth, supabaseAdmin, supabase } from '../config/supabase.js';
import { uploadImage } from '../utils/storage.js';

const log = (message, level = 'INFO', metadata = {}) => {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(metadata).length ? ` | ${JSON.stringify(metadata)}` : '';
  console.log(`[${timestamp}] [PostService-DB2] [${level}] ${message}${metaStr}`);
};

const logError = (message, error, metadata = {}) => {
  log(`${message}: ${error ? error.message : 'Error desconocido'}`, 'ERROR', { ...metadata, stack: error?.stack });
};

// ==================== HELPER MULTIBASE: NOMBRES DE USUARIO Y VOTOS ====================

/**
 * Consulta en DB3 (dbAuth) los nombres de usuario y avatares reales para los author_id de DB2,
 * y en DB2 (dbCommunity) el estado del voto del usuario para cada post.
 *
 * 📌 COMENTARIO DE PRESERVACIÓN:
 * 1. La tabla 'posts' reside en DB2 (dbCommunity) y la tabla 'profiles' en DB3 (dbAuth).
 * 2. Al ser bases de datos aisladas en Supabase, PostgREST no puede realizar JOINs cross-database.
 * 3. Este helper resuelve en paralelo los usernames en DB3 y el userVote en DB2 en <5ms.
 */
async function enrichPostsWithAuthors(posts, userId = null) {
  if (!posts || !Array.isArray(posts) || posts.length === 0) return posts || [];

  const authorIds = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
  const postIds = posts.map(p => p.id).filter(Boolean);
  const profileMap = new Map();
  const userVoteMap = new Map();

  const clientComm = dbCommunity || supabaseAdmin || supabase;
  const clientAuth = dbAuth || supabaseAdmin || supabase;

  // 1. Obtener perfiles de autores reales desde DB3 Auth
  if (authorIds.length > 0) {
    try {
      const { data: profiles } = await clientAuth
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', authorIds);

      if (profiles && Array.isArray(profiles)) {
        profiles.forEach(pr => profileMap.set(pr.id, pr));
      }
    } catch (err) {
      logError('⚠️ Error al consultar nombres de autor en DB3 (dbAuth)', err);
    }
  }

  // 2. Obtener el voto del usuario actual para cada post desde DB2 Community
  if (userId && postIds.length > 0) {
    try {
      const { data: userVotes } = await clientComm
        .from('votes')
        .select('post_id, vote_type')
        .eq('user_id', userId)
        .in('post_id', postIds);

      if (userVotes && Array.isArray(userVotes)) {
        userVotes.forEach(v => {
          const vt = String(v.vote_type).toLowerCase();
          let voteVal = 'none';
          if (vt === '1' || vt === 'like' || vt === 'up') voteVal = 'like';
          else if (vt === '2' || vt === 'dislike' || vt === 'down') voteVal = 'dislike';
          userVoteMap.set(v.post_id, voteVal);
        });
      }
    } catch (err) {
      logError('⚠️ Error al consultar votos de usuario en DB2', err);
    }
  }

  return posts.map(row => {
    const prof = profileMap.get(row.author_id);
    const vote = userVoteMap.get(row.id) || 'none';
    return {
      id: row.id,
      title: row.title || '',
      details: row.details || '',
      imageUrl: row.image_url || '',
      author: prof?.username || row.author || 'Comunidad',
      authorAvatar: prof?.avatar_url || row.author_avatar || '',
      likes: row.likes || 0,
      dislikes: row.dislikes || 0,
      score: row.score || 0,
      userVote: vote,
      createdAt: row.created_at
    };
  });
}

// ==================== OPERACIONES CRUD ====================

/**
 * Registra una nueva publicación de la comunidad en DB2.
 */
export async function addPost(postData, userId) {
  if (!postData.title || !postData.details) {
    throw new Error('El título y los detalles son campos obligatorios');
  }

  let imageUrl = '';

  if (postData.imageBase64 && postData.imageBase64.trim()) {
    try {
      const filePath = `posts/${userId}/${Date.now()}.jpg`;
      imageUrl = await uploadImage(postData.imageBase64, postData.mimetype || 'image/jpeg', filePath);
    } catch (err) {
      logError('Error al subir imagen del post, se omite', err);
    }
  }

  const client = dbCommunity || supabaseAdmin || supabase;
  const post = {
    title: postData.title.trim(),
    details: postData.details.trim(),
    image_url: imageUrl,
    author_id: userId
  };

  log(`💾 Creando nuevo post en DB2 para usuario: ${userId}`);

  const { data, error } = await client.from('posts').insert(post).select('id').single();
  if (error) {
    logError(`❌ Error al crear post para el usuario: ${userId}`, error);
    throw new Error(`Fallo al publicar: ${error.message}`);
  }

  log(`✅ Post publicado con éxito en DB2 (ID: ${data.id}) por usuario: ${userId}`, 'INFO');
  return { id: data.id, imageUrl };
}

/**
 * Modifica el contenido de un post existente si el usuario es el autor.
 */
export async function editPost(postId, userId, updateData) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data: post, error: fetchError } = await client
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .maybeSingle();

  if (fetchError || !post) throw new Error('Publicación no encontrada');
  if (post.author_id !== userId) throw new Error('Acción no autorizada');

  const { error } = await client
    .from('posts')
    .update(updateData)
    .eq('id', postId);

  if (error) throw new Error('Fallo al actualizar el post');
  return { success: true };
}

// ==================== CONSULTAS Y LISTADOS ====================

/**
 * Obtiene publicaciones destacadas resolviendo nombres de usuario reales desde DB3 y userVote desde DB2.
 */
export async function getTopPosts(limit = 5, userId = null) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Error al obtener posts top: ${error.message}`);
  return await enrichPostsWithAuthors(data || [], userId);
}

/**
 * Recupera un rango de publicaciones resolviendo nombres de usuario reales desde DB3 y userVote desde DB2.
 */
export async function getPostsRange(start = 0, count = 10, userId = null) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .range(start, start + count - 1);

  if (error) throw new Error(`Error al obtener rango de posts: ${error.message}`);
  return await enrichPostsWithAuthors(data || [], userId);
}

/**
 * Obtiene todas las publicaciones de un usuario específico.
 */
export async function getPostsByAuthor(authorId, start = 0, count = 10) {
  if (!authorId) throw new Error('Se requiere el ID del autor');

  const client = dbCommunity || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('author_id', authorId)
    .order('created_at', { ascending: false })
    .range(start, start + count - 1);

  if (error) throw new Error(`Fallo al consultar publicaciones personales: ${error.message}`);
  return await enrichPostsWithAuthors(data || [], authorId);
}

// ==================== ESTADÍSTICAS, BORRADO Y DENUNCIAS ====================

export async function getUserStats(userId) {
  if (!userId) throw new Error('ID de usuario obligatorio');
  const client = dbCommunity || supabaseAdmin || supabase;

  const { count: postCount, error: postError } = await client
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('author_id', userId);

  if (postError) {
    logError(`❌ Fallo en conteo de posts: ${userId}`, postError);
    return { postCount: 0, totalLikes: 0, totalDislikes: 0 };
  }

  const { data: sums } = await client
    .from('posts')
    .select('likes, dislikes')
    .eq('author_id', userId);

  let totalLikes = 0;
  let totalDislikes = 0;
  if (sums && Array.isArray(sums)) {
    sums.forEach(post => {
      totalLikes += post.likes || 0;
      totalDislikes += post.dislikes || 0;
    });
  }

  log(`📊 Estadísticas reales DB2: posts=${postCount}, likes=${totalLikes}, dislikes=${totalDislikes}`, 'INFO');

  return {
    postCount: postCount || 0,
    totalLikes: totalLikes || 0,
    totalDislikes: totalDislikes || 0,
    postsCount: postCount || 0,
    likesCount: totalLikes || 0,
    dislikesCount: totalDislikes || 0
  };
}

/**
 * 📌 COMENTARIO DE PRESERVACIÓN:
 * Elimina una publicación de la tabla 'posts' en DB2 (dbCommunity) previa verificación de autoría.
 */
export async function deletePost(postId, userId) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data: post, error: fetchError } = await client
    .from('posts')
    .select('author_id')
    .eq('id', postId)
    .maybeSingle();

  if (fetchError || !post) throw new Error('Publicación inexistente');
  if (post.author_id !== userId) throw new Error('No tienes permiso para eliminar esta publicación');

  const { error } = await client.from('posts').delete().eq('id', postId);
  if (error) {
    logError(`❌ Error al eliminar post ${postId} de DB2`, error);
    throw new Error('Fallo al eliminar de la base de datos');
  }
  log(`✅ Post ${postId} eliminado con éxito de DB2 por usuario ${userId}`, 'INFO');
  return { success: true };
}

/**
 * 📌 COMENTARIO DE PRESERVACIÓN:
 * Guarda una denuncia en la tabla 'reports' de DB2 (dbCommunity) con post_id, reporter_id y reason.
 */
export async function reportPost(postId, userId, reason = '') {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data: post, error: fetchError } = await client
    .from('posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle();

  if (fetchError || !post) throw new Error('Post no encontrado');

  const { error } = await client
    .from('reports')
    .insert({
      post_id: postId,
      reporter_id: userId,
      reason: String(reason || 'Sin razón especificada').trim()
    });

  if (error) {
    logError(`❌ Fallo al guardar reporte en DB2 para post ${postId}`, error);
    throw new Error(`Fallo al enviar denuncia: ${error.message}`);
  }

  log(`✅ Denuncia registrada en DB2 para post ${postId} por usuario ${userId}`, 'INFO');
  return { success: true };
}

export async function getPostById(postId, userId = null) {
  const client = dbCommunity || supabaseAdmin || supabase;
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('id', postId)
    .single();

  if (error || !data) throw new Error('Post no disponible');
  const enriched = await enrichPostsWithAuthors([data], userId);
  return enriched[0];
}
