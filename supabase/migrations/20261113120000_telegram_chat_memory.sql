-- The Telegram bot keeps the last few messages of each private chat here, so it still knows
-- what was being discussed after the backend restarts. Phone numbers are removed before a
-- message is stored. Only the backend (service role) can read or write this table.

create table if not exists public.telegram_chats (
  chat_id bigint primary key,
  history jsonb not null default '[]'::jsonb,
  selected text,
  choices jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now()
);

alter table public.telegram_chats enable row level security;

revoke all on public.telegram_chats from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_chats to service_role;

create index if not exists telegram_chats_updated_at_idx on public.telegram_chats (updated_at);
