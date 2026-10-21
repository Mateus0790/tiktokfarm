// Converte os eventos crus do TikTok em eventos simples que o overlay entende:
//   { kind: 'chat' | 'like' | 'gift' | 'follow' | 'share' | 'enter', user: {id, name, avatar}, ... }

function pickImageUrl(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  const urls = img.url || img.urlList || img.url_list || [];
  // Navegadores (e o OBS) não abrem HEIC; preferimos webp/jpeg.
  return urls.find((u) => !/\.heic/i.test(u)) || urls[0] || null;
}

export function normalizeUser(u) {
  if (!u) return null;
  const id = String(u.userId || u.uniqueId || u.displayId || '');
  if (!id || id === '0') return null;
  return {
    id,
    uniqueId: u.uniqueId || u.displayId || '',
    name: (u.nickname || u.uniqueId || u.displayId || 'Anônimo').slice(0, 24),
    avatar:
      pickImageUrl(u.profilePictureMedium) ||
      pickImageUrl(u.profilePicture) ||
      pickImageUrl(u.profilePictureLarge) ||
      u.profilePictureUrl ||
      null,
  };
}

/**
 * Presentes "combo" (giftType 1) chegam várias vezes com repeatCount crescente
 * até repeatEnd. Para o jogo reagir na hora, emitimos apenas a diferença
 * desde o último evento do mesmo combo.
 */
export class GiftStreakTracker {
  constructor() {
    this.streaks = new Map();
    setInterval(() => this.cleanup(), 30_000).unref();
  }

  delta(data) {
    const userId = data.user?.userId || data.user?.uniqueId || '?';
    const key = `${userId}:${data.giftId}:${data.groupId || ''}`;
    const repeat = Math.max(1, Number(data.repeatCount) || 1);
    const giftType = data.giftDetails?.giftType ?? data.giftType;
    const ended = Boolean(data.repeatEnd);

    if (giftType !== 1) return repeat;

    const prev = this.streaks.get(key)?.count || 0;
    if (ended) this.streaks.delete(key);
    else this.streaks.set(key, { count: Math.max(prev, repeat), at: Date.now() });
    return Math.max(0, repeat - prev);
  }

  cleanup() {
    const limit = Date.now() - 60_000;
    for (const [k, v] of this.streaks) if (v.at < limit) this.streaks.delete(k);
  }
}

export function normalizeGift(data, count) {
  const details = data.giftDetails || {};
  const ext = data.extendedGiftInfo || {};
  const unitDiamonds = Number(details.diamondCount || ext.diamond_count || data.diamondCount || 1);
  return {
    giftId: data.giftId,
    giftName: details.giftName || ext.name || data.giftName || 'Presente',
    giftImage: pickImageUrl(details.giftImage) || pickImageUrl(details.icon) || pickImageUrl(ext.image) || null,
    count,
    diamonds: Math.max(1, unitDiamonds) * count,
  };
}
