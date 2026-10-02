/**
 * Validação PURA do perfil do WhatsApp Business (Frente 3), antes de mandar pra
 * Meta. Limites baseados na doc da Cloud API — marcados `// CONFIRMAR` onde há
 * dúvida; a rota também devolve o erro cru da Meta, então divergência aparece.
 */

// Verticais (categorias) documentadas pela Meta. // CONFIRMAR na doc oficial.
export const VERTICALS = [
  "UNDEFINED",
  "OTHER",
  "AUTO",
  "BEAUTY",
  "APPAREL",
  "EDU",
  "ENTERTAIN",
  "EVENT_PLAN",
  "FINANCE",
  "GROCERY",
  "GOVT",
  "HOTEL",
  "HEALTH",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
  "NOT_A_BIZ",
] as const;
export type Vertical = (typeof VERTICALS)[number];

export type BusinessProfileFields = {
  about?: string;
  description?: string;
  email?: string;
  address?: string;
  vertical?: string;
  websites?: string[];
};

// Limites da Cloud API. // CONFIRMAR na doc oficial.
const LIMITS = { about: 139, description: 512, email: 128, address: 256, website: 256, websites: 2 };

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function isHttpUrl(s: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(s);
}

export function validateProfileFields(f: BusinessProfileFields): { ok: true } | { ok: false; error: string } {
  if (f.about != null && f.about.length > LIMITS.about) return { ok: false, error: `"Sobre" excede ${LIMITS.about} caracteres.` };
  if (f.description != null && f.description.length > LIMITS.description) return { ok: false, error: `Descrição excede ${LIMITS.description} caracteres.` };
  if (f.address != null && f.address.length > LIMITS.address) return { ok: false, error: `Endereço excede ${LIMITS.address} caracteres.` };
  if (f.email != null && f.email !== "") {
    if (f.email.length > LIMITS.email) return { ok: false, error: `Email excede ${LIMITS.email} caracteres.` };
    if (!isEmail(f.email)) return { ok: false, error: "Email inválido." };
  }
  if (f.vertical != null && f.vertical !== "" && !(VERTICALS as readonly string[]).includes(f.vertical)) {
    return { ok: false, error: "Categoria inválida." };
  }
  if (f.websites) {
    if (f.websites.length > LIMITS.websites) return { ok: false, error: `Máximo de ${LIMITS.websites} sites.` };
    for (const w of f.websites) {
      if (w.length > LIMITS.website) return { ok: false, error: `Site excede ${LIMITS.website} caracteres.` };
      if (!isHttpUrl(w)) return { ok: false, error: `Site inválido: ${w} (use http:// ou https://).` };
    }
  }
  return { ok: true };
}

/** Username da Meta: a-z, 0-9, ponto e underscore; sem acento/maiúscula. // CONFIRMAR tamanho. */
export function validateUsername(u: string): { ok: true } | { ok: false; error: string } {
  const v = u.trim();
  if (v.length < 3 || v.length > 30) return { ok: false, error: "Username deve ter de 3 a 30 caracteres." };
  if (!/^[a-z0-9._]+$/.test(v)) return { ok: false, error: "Use só letras minúsculas (a-z), números, ponto e underscore." };
  return { ok: true };
}
