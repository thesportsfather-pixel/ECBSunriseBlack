-- ECB SUNRISE FUNDRAISER
-- Run this entire file in the Supabase SQL Editor.
-- It creates the team, players, 100 baseballs per player, and orders table.

create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  team_key text not null unique,
  team_name text not null,
  goal_cents integer not null default 505000,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  player_key text not null,
  player_name text not null,
  player_number integer not null,
  created_at timestamptz not null default now(),
  unique(team_id, player_key),
  unique(team_id, player_number)
);

create table if not exists public.baseballs (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  ball_number integer not null check (ball_number between 1 and 100),
  status text not null default 'available' check (status in ('available','sold')),
  donor_name text,
  sold_at timestamptz,
  stripe_session_id text,
  created_at timestamptz not null default now(),
  unique(player_id, ball_number)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  donor_name text not null default 'Anonymous',
  anonymous boolean not null default false,
  baseball_numbers integer[] not null,
  amount_cents integer not null check (amount_cents > 0),
  stripe_session_id text not null unique,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists baseballs_team_player_idx on public.baseballs(team_id, player_id);
create index if not exists baseballs_status_idx on public.baseballs(status);
create index if not exists orders_team_player_idx on public.orders(team_id, player_id);

-- Team
insert into public.teams (team_key, team_name, goal_cents)
values ('ecb-sunrise', 'ECB Sunrise', 505000)
on conflict (team_key) do update
set team_name = excluded.team_name,
    goal_cents = excluded.goal_cents;

-- Players
with t as (
  select id from public.teams where team_key = 'ecb-sunrise'
)
insert into public.players (team_id, player_key, player_name, player_number)
select t.id, v.player_key, v.player_name, v.player_number
from t
cross join (
  values
    ('anthony-c','Anthony C',1),
    ('jack-j','Jack J',2),
    ('ezra-f','Ezra F',7),
    ('zachary-z','Zachary Z',11),
    ('harrison-z','Harrison Z',12),
    ('nicolas-h','Nicolas H',15),
    ('andrew-p','Andrew P',16),
    ('dylan-n','Dylan N',20),
    ('julian-s','Julian S',27),
    ('eli-o','Eli O',28),
    ('jase-h','Jase H',44)
) as v(player_key, player_name, player_number)
on conflict (team_id, player_key) do update
set player_name = excluded.player_name,
    player_number = excluded.player_number;

-- Generate baseballs 1 through 100 for every ECB Sunrise player.
insert into public.baseballs (team_id, player_id, ball_number)
select p.team_id, p.id, gs.ball_number
from public.players p
join public.teams t on t.id = p.team_id
cross join generate_series(1,100) as gs(ball_number)
where t.team_key = 'ecb-sunrise'
on conflict (player_id, ball_number) do nothing;

-- Optional verification queries:
select t.team_name, count(p.id) as player_count
from public.teams t
left join public.players p on p.team_id = t.id
where t.team_key = 'ecb-sunrise'
group by t.team_name;

select p.player_name, p.player_number, count(b.id) as baseball_count
from public.players p
join public.teams t on t.id = p.team_id
left join public.baseballs b on b.player_id = p.id
where t.team_key = 'ecb-sunrise'
group by p.id, p.player_name, p.player_number
order by p.player_number;
