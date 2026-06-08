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
  business_description TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'star')),
  logo TEXT DEFAULT '🏪',
  accent_color TEXT DEFAULT '#6366f1',
  portal_title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Sucursales (Puntos físicos)
CREATE TABLE public.locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  maps_url TEXT NOT NULL,
  phone TEXT,
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

-- 4. Automatización de Perfil (Solo para usuarios reales de Supabase Auth)
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

-- 🛡️ POLÍTICAS PARA PROFILES
-- El dueño puede ver y editar su propio perfil.
-- Se permite acceso al ID de desarrollo actual.
CREATE POLICY "Permitir gestión de perfil propio" ON public.profiles
  FOR ALL USING (auth.uid() = id OR id = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

-- 🛡️ POLÍTICAS PARA LOCATIONS
-- El dueño gestiona sus locales.
-- Lectura pública para que los clientes puedan ver el portal de opinión.
CREATE POLICY "Dueños gestionan sus locales" ON public.locations
  FOR ALL USING (auth.uid() = tenant_id OR tenant_id = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

CREATE POLICY "Lectura pública de locales para clientes" ON public.locations
  FOR SELECT USING (true);

-- 🛡️ POLÍTICAS PARA LEADS
-- El dueño ve sus leads.
-- Cualquiera puede insertar (el cliente final desde el portal).
CREATE POLICY "Dueños ven sus leads" ON public.leads
  FOR SELECT USING (auth.uid() = tenant_id OR tenant_id = '36d917a3-f764-4afe-8c87-e1db8f0f1731');

CREATE POLICY "Inserción pública de leads para clientes" ON public.leads
  FOR INSERT WITH CHECK (true);
