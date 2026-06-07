DROP TABLE IF EXISTS public.leads;
DROP TABLE IF EXISTS public.locations;
DROP TABLE IF EXISTS public.profiles;

CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  business_name TEXT,
  full_name TEXT,
  email TEXT,
  whatsapp TEXT,
  address TEXT,
  plan TEXT DEFAULT 'free',
  logo TEXT DEFAULT '🏪',
  accent_color TEXT DEFAULT '#6366f1',
  portal_title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to handle new user creation
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

-- Trigger to call the function on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE TABLE public.locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  maps_url TEXT,
  status TEXT DEFAULT 'inactive',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Tenants can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Tenants can view their own locations" ON public.locations FOR SELECT USING (auth.uid() = tenant_id);
CREATE POLICY "Tenants can insert their own locations" ON public.locations FOR INSERT WITH CHECK (auth.uid() = tenant_id);
CREATE POLICY "Tenants can update their own locations" ON public.locations FOR UPDATE USING (auth.uid() = tenant_id);

CREATE POLICY "Tenants can view their own leads" ON public.leads FOR SELECT USING (auth.uid() = tenant_id);
CREATE POLICY "Anyone can insert leads" ON public.leads FOR INSERT WITH CHECK (true);
