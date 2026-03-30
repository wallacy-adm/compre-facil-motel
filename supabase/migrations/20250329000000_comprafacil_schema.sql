-- CompraFácil — Schema inicial (Rodada 5)
-- Execute no SQL Editor do Supabase (ou via supabase db push)

create table if not exists users (
  id text primary key,
  name text not null,
  username text unique not null,
  password text not null,
  role text,
  roles jsonb,
  active boolean default true,
  deleted boolean default false
);

create table if not exists orders (
  id text primary key,
  user_id text,
  user_name text,
  sector text,
  sector_label text,
  user_role text,
  created_at text,
  created_date text,
  priority text,
  status text,
  destino text,
  items jsonb,
  inserted_at timestamptz default now()
);

-- Habilitar Realtime na tabela orders
alter publication supabase_realtime add table orders;
