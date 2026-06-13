-- ==========================================================
-- 🚀 IMPULSA: ESQUEMA DEFINITIVO DE BASE DE DATOS
-- ==========================================================
-- Este script recrea toda la estructura, eliminando datos previos.

-- 0. Limpieza Total
DROP TABLE IF EXISTS public.leads;
DROP TABLE IF EXISTS public.locations;
DROP TABLE IF EXISTS public.profiles;

-- 1. Tabla de Planes (Configuración dinámica de la plataforma)
CREATE TABLE public.plans (
  id TEXT PRIMARY KEY, -- 'free', 'pro', 'star'
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  location_limit INTEGER, -- NULL para ilimitado
  features TEXT[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar configuración inicial de planes
INSERT INTO public.plans (id, name, price, location_limit, features) VALUES
('free', 'Plan Starter', 0.00, 1, ARRAY['Indicador LED animado', 'Códigos QR de Alta Definición', 'Portal móvil personalizable']),
('pro', 'Plan Pro Profesional', 64000.00, 3, ARRAY['Indicador LED animado', 'Códigos QR de Alta Definición', 'Portal móvil personalizable', 'Filtro estratégico de reseñas', 'Simulador de servidor de API']),
('star', 'Plan Star Ilimitado', 116000.00, NULL, ARRAY['Indicador LED animado', 'Códigos QR de Alta Definición', 'Portal móvil personalizable', 'Filtro estratégico de reseñas', 'Simulador de servidor de API', 'Soporte prioritario'])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  location_limit = EXCLUDED.location_limit,
  features = EXCLUDED.features;

-- Habilitar RLS para Planes
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura pública de planes" ON public.plans FOR SELECT USING (true);
CREATE POLICY "Solo SuperAdmin gestiona planes" ON public.plans FOR ALL 
  USING (auth.uid() = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

-- 2. Tabla de Perfiles (Cuentas de Comercio)
-- Se actualiza para incluir campos financieros
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  business_name TEXT,
  full_name TEXT,
  email TEXT,
  whatsapp TEXT,
  address TEXT,
  city TEXT,
  business_description TEXT,
  plan TEXT DEFAULT 'free' REFERENCES public.plans(id),
  logo TEXT DEFAULT '🏪',
  accent_color TEXT DEFAULT '#6366f1',
  bg_color TEXT DEFAULT '#ffffff',
  portal_title TEXT,
  -- Columnas Financieras
  last_payment_amount NUMERIC(10,2) DEFAULT 0,
  subscription_period INTEGER DEFAULT 1,
  subscription_date TIMESTAMPTZ,
  subscription_expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================================
-- 🪣 CONFIGURACIÓN DE ALMACENAMIENTO (SUPABASE STORAGE)
-- ==========================================================
-- Nota: Ejecutar esto en el SQL Editor de Supabase.
-- Algunos comandos de Storage pueden requerir el dashboard para la creación inicial del bucket.

-- Crear el bucket 'logos' si no existe (vía rpc o manual en panel)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true) ON CONFLICT (id) DO NOTHING;

-- Políticas para el Bucket 'logos'
-- Eliminamos las anteriores para evitar duplicados
DROP POLICY IF EXISTS "Logos son públicos" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios pueden subir logos" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios pueden gestionar sus logos" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios pueden subir sus propios logos" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios pueden actualizar sus propios logos" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios pueden borrar sus propios logos" ON storage.objects;

-- 1. Permitir lectura pública de todos los logos
CREATE POLICY "Logos son públicos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'logos');

-- 2. Permitir inserción (Cualquiera por ahora para facilitar desarrollo, o restringido al ID de Mauro)
CREATE POLICY "Usuarios pueden subir logos" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'logos');

-- 3. Permitir actualización y borrado (Solo dueños o ID de Mauro)
CREATE POLICY "Usuarios pueden gestionar sus logos" 
ON storage.objects FOR ALL 
USING (bucket_id = 'logos');


-- 2. Tabla de Sucursales (Puntos físicos)
CREATE TABLE public.locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  maps_url TEXT NOT NULL,
  phone TEXT,
  logo TEXT, -- Nueva columna para logo por sucursal
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de Leads (Opiniones/Soporte interceptado)
CREATE TABLE public.leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'resolved')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla de Solicitudes de Sucursal (Para creación delegada)
CREATE TABLE public.location_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  loc_name TEXT NOT NULL,
  loc_address TEXT NOT NULL,
  loc_accent_color TEXT DEFAULT '#6366f1',
  loc_logo TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabla de Configuración Global (Wompi, etc)
CREATE TABLE public.global_config (
  id TEXT PRIMARY KEY, -- 'wompi'
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar fila inicial para Wompi si no existe
INSERT INTO public.global_config (id, data) 
VALUES ('wompi', '{"publicKey": "", "privateKey": "", "integritySecret": ""}')
ON CONFLICT (id) DO NOTHING;

-- Habilitar RLS
ALTER TABLE public.global_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura pública de config" ON public.global_config FOR SELECT USING (true);
CREATE POLICY "Solo SuperAdmin edita config" ON public.global_config FOR ALL 
  USING (auth.uid() = '36d917a3-f764-4afe-8c87-e1db8f0f1731'); -- ID de Admin Mauro

-- 5. Automatización de Perfil (Solo para usuarios reales de Supabase Auth)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, business_name)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    new.email,
    new.raw_user_meta_data->>'business_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 5. Configuración de Seguridad (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_requests ENABLE ROW LEVEL SECURITY;

-- 🛡️ POLÍTICAS PARA PROFILES
-- ... (mismo código)
CREATE POLICY "Permitir gestión de perfil propio" ON public.profiles
  FOR ALL USING (auth.uid() = id OR id = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

-- 🛡️ POLÍTICAS PARA LOCATIONS
-- ... (mismo código)
CREATE POLICY "Dueños gestionan sus locales" ON public.locations
  FOR ALL USING (auth.uid() = tenant_id OR tenant_id = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

CREATE POLICY "Lectura pública de locales para clientes" ON public.locations
  FOR SELECT USING (true);

-- 🛡️ POLÍTICAS PARA LEADS
-- ... (mismo código)
CREATE POLICY "Dueños ven sus leads" ON public.leads
  FOR SELECT USING (auth.uid() = tenant_id OR tenant_id = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

CREATE POLICY "Inserción pública de leads para clientes" ON public.leads
  FOR INSERT WITH CHECK (true);

-- 🛡️ POLÍTICAS PARA LOCATION_REQUESTS
CREATE POLICY "Dueños gestionan sus solicitudes" ON public.location_requests
  FOR ALL USING (auth.uid() = tenant_id OR tenant_id = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

CREATE POLICY "SuperAdmin ve todas las solicitudes" ON public.location_requests
  FOR SELECT USING (auth.uid() = '36d917a3-f764-4afe-8c87-e1db8f0f1731'); -- ID de Admin Mauro


-- 6. Tabla de Prospectos de Mercadeo (Portales Pre-construidos)
CREATE TABLE public.marketing_prospects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_name TEXT NOT NULL,
  logo TEXT DEFAULT '🏪',
  accent_color TEXT DEFAULT '#6366f1',
  contact_name TEXT,
  contact_whatsapp TEXT,
  loc_name TEXT NOT NULL,
  loc_address TEXT,
  loc_maps_url TEXT NOT NULL,
  status TEXT DEFAULT 'prospect' CHECK (status IN ('prospect', 'shared', 'converted')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  converted_tenant_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Habilitar RLS para Mercadeo
ALTER TABLE public.marketing_prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY \
SuperAdmin
gestiona
prospectos\ ON public.marketing_prospects 
  FOR ALL USING (auth.uid() = '36d917a3-f764-4afe-8c87-e1db8f0f1731');
CREATE POLICY \Lectura
pública
de
prospectos
para
previsualización\ ON public.marketing_prospects 
  FOR SELECT USING (true);

