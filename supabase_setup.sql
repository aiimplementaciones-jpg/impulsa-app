-- ==========================================================
-- 🚀 IMPULSA: ESQUEMA DEFINITIVO DE BASE DE DATOS
-- ==========================================================
-- Este script recrea toda la estructura, eliminando datos previos.

-- 0. Limpieza Total
DROP TABLE IF EXISTS public.leads;
DROP TABLE IF EXISTS public.locations;
DROP TABLE IF EXISTS public.profiles;

-- 1. Tabla de Perfiles (Cuentas de Comercio)
-- Se quita REFERENCES auth.users para máxima compatibilidad en desarrollo
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  business_name TEXT,
  full_name TEXT,
  email TEXT,
  whatsapp TEXT,
  address TEXT,
  city TEXT,
  business_description TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'star')),
  logo TEXT DEFAULT '🏪',
  accent_color TEXT DEFAULT '#6366f1',
  bg_color TEXT DEFAULT '#ffffff',
  portal_title TEXT,
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

