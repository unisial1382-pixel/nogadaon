-- Run in a fresh Supabase SQL editor. Enable email confirmation in Auth settings.
create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text not null,role text not null default 'worker' check(role in ('worker','company','agency','admin')),verified boolean not null default false,created_at timestamptz default now());
create function public.create_profile() returns trigger language plpgsql security definer set search_path=public as $$begin insert into public.profiles(id,email,role) values(new.id,new.email,case when new.raw_user_meta_data->>'role' in ('worker','company','agency') then new.raw_user_meta_data->>'role' else 'worker' end);return new;end$$;
create trigger on_signup after insert on auth.users for each row execute function public.create_profile();
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
create function public.is_verified_business() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.profiles where id=auth.uid() and role in ('company','agency') and verified)$$;
create table public.jobs(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),title text not null,region text not null,daily_pay integer not null check(daily_pay>0),slots integer not null check(slots>0),description text default '',status text not null default 'open' check(status in ('open','closed')),created_at timestamptz default now());
create table public.applications(id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs(id) on delete cascade,applicant_id uuid not null references public.profiles(id),status text not null default 'pending' check(status in ('pending','accepted','rejected')),created_at timestamptz default now(),unique(job_id,applicant_id));
create table public.workers(id uuid primary key default gen_random_uuid(),agency_id uuid not null references public.profiles(id),display_name text not null,trade text not null,created_at timestamptz default now());
create table public.assignments(id uuid primary key default gen_random_uuid(),agency_id uuid not null references public.profiles(id),worker_id uuid not null references public.workers(id),job_id uuid not null references public.jobs(id),work_date date not null,status text not null default 'assigned' check(status in ('assigned','attended','cancelled')),created_at timestamptz default now());
create function public.check_assignment() returns trigger language plpgsql security definer set search_path=public as $$begin if not exists(select 1 from public.workers where id=new.worker_id and agency_id=new.agency_id) or not exists(select 1 from public.jobs where id=new.job_id and owner_id=new.agency_id) then raise exception 'worker and job must belong to agency';end if;return new;end$$;
create trigger assignment_guard before insert or update on public.assignments for each row execute function public.check_assignment();
create function public.guard_profile_changes() returns trigger language plpgsql set search_path=public as $$begin if not public.is_admin() and (new.role is distinct from old.role or new.verified is distinct from old.verified or new.email is distinct from old.email) then raise exception 'restricted profile fields';end if;return new;end$$;
create trigger profile_guard before update on public.profiles for each row execute function public.guard_profile_changes();
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.workers enable row level security;
alter table public.assignments enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy profile_admin_update on public.profiles for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy jobs_read on public.jobs for select to authenticated using(status='open' or owner_id=auth.uid() or public.is_admin());
create policy jobs_insert on public.jobs for insert to authenticated with check(owner_id=auth.uid() and public.is_verified_business());
create policy jobs_update on public.jobs for update to authenticated using(owner_id=auth.uid() and public.is_verified_business()) with check(owner_id=auth.uid() and public.is_verified_business());
create policy applications_read on public.applications for select to authenticated using(applicant_id=auth.uid() or exists(select 1 from public.jobs where id=job_id and owner_id=auth.uid()) or public.is_admin());
create policy applications_insert on public.applications for insert to authenticated with check(applicant_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and role='worker') and exists(select 1 from public.jobs where id=job_id and status='open'));
create policy applications_update on public.applications for update to authenticated using(exists(select 1 from public.jobs where id=job_id and owner_id=auth.uid()) and public.is_verified_business()) with check(exists(select 1 from public.jobs where id=job_id and owner_id=auth.uid()) and public.is_verified_business());
create policy workers_read on public.workers for select to authenticated using(agency_id=auth.uid() or public.is_admin());
create policy workers_insert on public.workers for insert to authenticated with check(agency_id=auth.uid() and public.is_verified_business());
create policy assignments_read on public.assignments for select to authenticated using(agency_id=auth.uid() or public.is_admin());
create policy assignments_insert on public.assignments for insert to authenticated with check(agency_id=auth.uid() and public.is_verified_business());
-- Promote the initial admin ONLY from SQL editor after signing up; never expose service_role key to browser:
-- update public.profiles set role='admin',verified=true where email='YOUR_ADMIN_EMAIL';

-- Prevent an owner from reassigning an application to another applicant/job.
create function public.guard_application_identity() returns trigger language plpgsql set search_path=public as $$
begin
  if new.job_id is distinct from old.job_id or new.applicant_id is distinct from old.applicant_id or new.created_at is distinct from old.created_at then
    raise exception 'application identity cannot be changed';
  end if;
  return new;
end$$;
create trigger application_identity_guard before update on public.applications for each row execute function public.guard_application_identity();

-- Restrict security-definer helper execution to logged-in users.
revoke all on function public.is_admin() from public;
revoke all on function public.is_verified_business() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_verified_business() to authenticated;
