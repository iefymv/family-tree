// Связь между двумя УЖЕ существующими людьми (RPC link_relative): «Это моя мама» у карточки без связей.
import { db } from './supabase';

/** Кто другой человек для меня: родитель, ребёнок, супруг(а), брат или сестра. */
export type LinkKind = 'parent' | 'child' | 'spouse' | 'sibling';

export class LinkError extends Error {}

export async function linkRelative(selfId: string, otherId: string, kind: LinkKind): Promise<void> {
  const { error } = await db().rpc('link_relative', { self_person: selfId, other_person: otherId, kind });
  if (!error) return;
  const m = error.message ?? '';
  if (/already has two parents/.test(m)) throw new LinkError('У этого человека на дереве уже двое родителей');
  if (/already has parents/.test(m)) throw new LinkError('У вас уже указаны родители — брата или сестру добавьте через «+»');
  if (error.code === '23505') throw new LinkError('Эта связь уже есть на дереве');
  if (error.code === '42501') throw new LinkError('Связывать можно только свою карточку');
  if (error.code === 'P0002') throw new LinkError('Человек не найден — обновите страницу');
  throw new LinkError('Не получилось связать. Попробуйте ещё раз.');
}
