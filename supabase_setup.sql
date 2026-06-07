-- Limpiar tablas existentes (CUIDADO: Esto borra datos actuales)
DROP TABLE IF EXISTS public.leads;
DROP TABLE IF EXISTS public.locations;
DROP TABLE IF EXISTS public.profiles;

-- 1. Tabla de Perfiles (Extensión de auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
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

-- 2. Tabla de Sucursales
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

-- 3. Tabla de Leads (Reseñas interceptadas)
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

-- 4. Funciones y Triggers de Automatización
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, business_name)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    new.email,
    new.raw_user_meta_data->>'business_name'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 5. Seguridad de Nivel de Fila (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Políticas para Profiles
CREATE POLICY "Tenants can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Tenants can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Políticas para Locations
CREATE POLICY "Tenants can view their own locations" ON public.locations FOR SELECT USING (auth.uid() = tenant_id);
CREATE POLICY "Tenants can insert their own locations" ON public.locations FOR INSERT WITH CHECK (auth.uid() = tenant_id);
CREATE POLICY "Tenants can update their own locations" ON public.locations FOR UPDATE USING (auth.uid() = tenant_id);

-- Políticas para Leads
CREATE POLICY "Tenants can view their own leads" ON public.leads FOR SELECT USING (auth.uid() = tenant_id);
CREATE POLICY "Anyone can insert leads" ON public.leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Tenants can update their own leads" ON public.leads FOR UPDATE USING (auth.uid() = tenant_id);
