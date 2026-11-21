-- schema.sql, admin.sql, requests.sql 적용 후 실행합니다.
create table if not exists public.creation_upload_history (
  id bigint generated always as identity primary key,
  creation_id uuid not null references public.creations(id) on delete cascade,
  member_id uuid not null,
  admin_id uuid not null,
  occurred_at timestamptz not null default now(),
  kind text not null,
  title text,
  status text not null,
  published boolean not null,
  added_count integer not null,
  removed_count integer not null,
  file_count integer not null
);

create index if not exists creation_upload_history_member_idx
  on public.creation_upload_history (member_id, occurred_at desc, id desc);
create index if not exists creation_upload_history_admin_idx
  on public.creation_upload_history (admin_id, occurred_at desc, id desc);

alter table public.creation_upload_history enable row level security;
revoke all on public.creation_upload_history from public, anon, authenticated;
grant select on public.creation_upload_history to authenticated;
drop policy if exists "admins read upload history" on public.creation_upload_history;
create policy "admins read upload history" on public.creation_upload_history
  for select to authenticated using (public.is_admin());

create or replace function private.log_creation_upload()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_added integer;
  v_removed integer;
begin
  if auth.uid() is null or not public.is_admin() then return new; end if;
  if (old.title, old.content, old.media, old.external_url, old.status, old.error)
     is not distinct from (new.title, new.content, new.media, new.external_url, new.status, new.error) then
    return new;
  end if;

  select count(*) into v_added from (
    select m->>'path' from jsonb_array_elements(new.media) m
    except select m->>'path' from jsonb_array_elements(old.media) m
  ) added;
  select count(*) into v_removed from (
    select m->>'path' from jsonb_array_elements(old.media) m
    except select m->>'path' from jsonb_array_elements(new.media) m
  ) removed;

  insert into public.creation_upload_history
    (creation_id, member_id, admin_id, kind, title, status, published, added_count, removed_count, file_count)
  values
    (new.id, new.user_id, auth.uid(), new.kind, new.title, new.status,
     new.status = 'ready' and old.status <> 'ready', v_added, v_removed, jsonb_array_length(new.media));
  return new;
end $$;

revoke all on function private.log_creation_upload() from public, anon, authenticated;
drop trigger if exists creation_upload_history_log on public.creations;
create trigger creation_upload_history_log
  after update of title, content, media, external_url, status, error on public.creations
  for each row execute function private.log_creation_upload();
