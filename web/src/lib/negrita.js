// Negrita para Instagram. Instagram no entiende **markdown**: la negrita que se ve en los captions son
// letras Unicode "Mathematical Sans-Serif Bold" (𝗛𝗼𝗹𝗮). Las tildes y la ñ se escriben con la letra en
// negrita + su tilde combinada (á = 𝗮 + ◌́), así no se pierden.
// Lo usan el editor de caption (botón B) y la publicación en Instagram (convierte **así** a negrita).

const MAY = 0x1d5d4; // 𝗔
const MIN = 0x1d5ee; // 𝗮
const NUM = 0x1d7ec; // 𝟬

function letraANegrita(c) {
  const n = c.codePointAt(0);
  if (n >= 65 && n <= 90) return String.fromCodePoint(MAY + n - 65);
  if (n >= 97 && n <= 122) return String.fromCodePoint(MIN + n - 97);
  if (n >= 48 && n <= 57) return String.fromCodePoint(NUM + n - 48);
  return c;
}

function letraDeNegrita(c) {
  const n = c.codePointAt(0);
  if (n >= MAY && n < MAY + 26) return String.fromCharCode(65 + n - MAY);
  if (n >= MIN && n < MIN + 26) return String.fromCharCode(97 + n - MIN);
  if (n >= NUM && n < NUM + 10) return String.fromCharCode(48 + n - NUM);
  return c;
}

const esLetraNegrita = (c) => {
  const n = c.codePointAt(0);
  return (n >= MAY && n < MAY + 52) || (n >= NUM && n < NUM + 10);
};
const esLetraNormal = (c) => /[A-Za-z0-9]/.test(c);

export function aNegrita(texto) {
  return Array.from(String(texto ?? '').normalize('NFD'), letraANegrita).join('');
}

export function quitarNegrita(texto) {
  return Array.from(String(texto ?? ''), letraDeNegrita).join('').normalize('NFC');
}

// ¿Está todo en negrita? (lo que no es letra ni número no cuenta). Sirve para que el botón B quite o ponga.
export function esNegrita(texto) {
  const l = Array.from(String(texto ?? '').normalize('NFD'));
  let alguna = false;
  for (const c of l) {
    if (esLetraNormal(c)) return false;
    if (esLetraNegrita(c)) alguna = true;
  }
  return alguna;
}

export const alternarNegrita = (texto) => (esNegrita(texto) ? quitarNegrita(texto) : aNegrita(texto));

// "Comenta **GUÍA** y te la envío" → "Comenta 𝗚𝗨𝗜́𝗔 y te la envío". Solo pares cerrados y en una línea.
export function markdownANegrita(texto) {
  if (texto == null) return texto;
  return String(texto).replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, (_, x) => aNegrita(x));
}
