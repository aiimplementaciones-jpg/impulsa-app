-- ==========================================================
-- IMPULSA: SISTEMA DE TRACKING DE RESENAS GOOGLE MAPS
-- ==========================================================
-- Ejecutar este script en el editor SQL de Supabase
-- DESPUES del script principal supabase_setup.sql
-- ==========================================================

-- -------------------------------------------------------
-- TABLA 1: five_star_redirects
-- Registra CADA VEZ que un cliente da 5 estrellas y es
-- redirigido anonimamente a Google Maps. Sin datos del cliente.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.five_star_redirects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  -- No guardamos ningun dato del cliente (anonimo por diseno)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para consultas rapidas por tenant y por sucursal
CREATE INDEX IF NOT EXISTS idx_five_star_tenant ON public.five_star_redirects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_five_star_location ON public.five_star_redirects(location_id);
CREATE INDEX IF NOT EXISTS idx_five_star_date ON public.five_star_redirects(created_at);

-- -------------------------------------------------------
-- TABLA 2: google_reviews_snapshots
-- Guarda el conteo historico de resenas en Google Maps
-- cada 15 dias (registro ingresado por el dueño del negocio).
-- Permite ver la evolucion real de la reputacion.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_reviews_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  review_count INTEGER NOT NULL CHECK (review_count >= 0),
  maps_rating NUMERIC(2,1) CHECK (maps_rating >= 1.0 AND maps_rating <= 5.0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para historial cronologico por sucursal
CREATE INDEX IF NOT EXISTS idx_greviews_tenant ON public.google_reviews_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_greviews_location ON public.google_reviews_snapshots(location_id);
CREATE INDEX IF NOT EXISTS idx_greviews_date ON public.google_reviews_snapshots(created_at);

-- ==========================================================
-- SEGURIDAD (RLS)
-- ==========================================================

ALTER TABLE public.five_star_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_reviews_snapshots ENABLE ROW LEVEL SECURITY;

-- Politicas para five_star_redirects
CREATE POLICY "Insercion publica de redirects 5 estrellas"
  ON public.five_star_redirects
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Duenos y admin ven sus redirects"
  ON public.five_star_redirects
  FOR SELECT
  USING (auth.uid() = tenant_id OR auth.uid() = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

CREATE POLICY "Solo SuperAdmin elimina redirects"
  ON public.five_star_redirects
  FOR DELETE
  USING (auth.uid() = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

-- Politicas para google_reviews_snapshots
CREATE POLICY "Duenos gestionan sus snapshots o admin"
  ON public.google_reviews_snapshots
  FOR ALL
  USING (auth.uid() = tenant_id OR auth.uid() = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

-- Verificacion: mostrar tablas creadas
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('five_star_redirects', 'google_reviews_snapshots')
ORDER BY table_name;
