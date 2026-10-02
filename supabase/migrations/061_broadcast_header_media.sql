-- 061 · Onda 3 (opção A). Migration ADITIVA: guarda a URL de mídia do
-- cabeçalho (IMAGE/VIDEO/DOCUMENT) por campanha. O envio server-side é
-- durável (o cron de drenagem reconstrói o plano a partir do banco), então
-- a URL precisa ficar PERSISTIDA na campanha — senão o cabeçalho de mídia
-- se perde no chute inicial e em todo passe de drenagem. NULL = sem mídia
-- (texto/corpo apenas), preservando as campanhas atuais.

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS header_media_url text;

COMMENT ON COLUMN public.broadcasts.header_media_url IS
  'URL da mídia do cabeçalho (IMAGE/VIDEO/DOCUMENT) da campanha; repassada à Meta em messageParams.headerMediaUrl no envio. NULL = template sem header de mídia.';
