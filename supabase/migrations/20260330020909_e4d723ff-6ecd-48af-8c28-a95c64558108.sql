
-- Users table
CREATE TABLE public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'estoque',
  roles JSONB NOT NULL DEFAULT '["estoque"]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  deleted BOOLEAN NOT NULL DEFAULT false
);

-- Orders table
CREATE TABLE public.orders (
  id BIGINT PRIMARY KEY,
  "userId" TEXT,
  "userName" TEXT,
  sector TEXT,
  "sectorLabel" TEXT,
  "userRole" TEXT,
  "createdAt" TEXT,
  "createdDate" TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pendente',
  destino TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Disable RLS (app uses custom auth, not Supabase Auth)
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;

-- Enable Realtime for orders
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
