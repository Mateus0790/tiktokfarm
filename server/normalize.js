// Converte os eventos crus do TikTok em eventos simples que o overlay entende:
//   { kind: 'chat' | 'like' | 'gift' | 'follow' | 'share' | 'enter', user: {id, name, avatar}, ... }
//
// O tiktok-live-connector 2.x entrega as mensagens no formato "v3" do protobuf
// (ex.: user.avatarThumb.urlList, chat.content, gift.gift.diamondCount), embora a
// documentação dele ainda mostre os nomes antigos (profilePicture, comment,
// giftDetails...). Aceitamos os dois formatos para não quebrar em atualizações.

function pickImageUrl(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  const urls = img.urlList || img.url || img.url_list || [];
  if (!Array.isArray(urls)) return typeof urls === 'string' ? urls : null;
  // Navegadores (e o OBS) não abrem HEIC; preferimos webp/jpeg.
  return urls.find((u) => u && !/\.heic/i.test(u)) || null;
}

const validId = (v) => v != null && v !== '' && String(v) !== '0';

export function normalizeUser(u) {
  if (!u) return null;
  const id = [u.idStr, u.id, u.userId, u.secUid, u.displayId, u.uniqueId].find(validId);
  if (!id) return null;
  const handle = u.displayId || u.uniqueId || '';
  return {
    id: String(id),
    uniqueId: handle,
    name: String(u.nickname || handle || 'Anônimo').slice(0, 24),
    avatar:
      pickImageUrl(u.avatarThumb) ||
      pickImageUrl(u.avatarMedium) ||
      pickImageUrl(u.avatarLarge) ||
      pickImageUrl(u.profilePictureMedium) ||
      pickImageUrl(u.profilePicture) ||
      pickImageUrl(u.profilePictureLarge) ||
      pickImageUrl(u.profilePictureUrl) ||
      null,
  };
}

export const chatText = (d) => String(d.content ?? d.comment ?? '').slice(0, 200);
export const likeCount = (d) => Math.max(1, Number(d.count ?? d.likeCount) || 1);
export const viewerCount = (d) => Number(d.total ?? d.viewerCount) || 0;

const giftDetails = (d) => d.gift || d.giftDetails || {};
const giftType = (d) => giftDetails(d).type ?? giftDetails(d).giftType ?? d.giftType;

/**
 * Presentes "combo" (tipo 1) chegam várias vezes com repeatCount crescente
 * até repeatEnd. Para o jogo reagir na hora, emitimos apenas a diferença
 * desde o último evento do mesmo combo.
 */
export class GiftStreakTracker {
  constructor() {
    this.streaks = new Map();
    setInterval(() => this.cleanup(), 30_000).unref();
  }

  delta(data) {
    const userId = normalizeUser(data.user)?.id || '?';
    const key = `${userId}:${data.giftId}:${data.groupId || ''}`;
    const repeat = Math.max(1, Number(data.repeatCount) || 1);
    const ended = Boolean(data.repeatEnd);

    if (Number(giftType(data)) !== 1) return repeat; // presente sem combo: chega uma vez só

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
  const details = giftDetails(data);
  const ext = data.extendedGiftInfo || {};
  const unitDiamonds = Number(details.diamondCount || ext.diamond_count || ext.diamondCount || data.diamondCount || 1);
  return {
    giftId: String(data.giftId ?? details.id ?? ''),
    giftName: details.name || details.giftName || ext.name || data.giftName || 'Presente',
    giftImage: pickImageUrl(details.image) || pickImageUrl(details.giftImage) || pickImageUrl(details.icon) || pickImageUrl(ext.image) || null,
    count,
    diamonds: Math.max(1, unitDiamonds) * count,
  };
}
