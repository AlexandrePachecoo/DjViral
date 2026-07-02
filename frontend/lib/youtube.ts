// Validação de links do YouTube. Espelha backend/app/youtube.py — mantenha
// os dois em sincronia. Aceita watch, youtu.be, shorts e music.youtube; o id
// de vídeo tem 11 caracteres [A-Za-z0-9_-].
const ID_PATTERNS = [
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})/,
  /^(?:https?:\/\/)?(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
];

export function extractYoutubeId(url: string): string | null {
  for (const pattern of ID_PATTERNS) {
    const match = url.trim().match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function canonicalYoutubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
