-- Mantem historico comercial, permite retirar planos antigos do catalogo e
-- cria auditoria idempotente para aulas anuladas/inativadas.

alter table public.plans
  add column if not exists deleted_at timestamptz;

create index if not exists idx_plans_catalog
  on public.plans (active, deleted_at, created_at desc);

create table if not exists public.class_occurrence_audits (
  id uuid primary key default gen_random_uuid(),
  class_schedule_id uuid not null references public.class_schedules(id) on delete cascade,
  date date not null,
  status text not null default 'normal'
    check (status in ('normal', 'nullified', 'inactivated')),
  reason text,
  affected_students integer not null default 0,
  audited_by uuid references public.profiles(id) on delete set null,
  audited_at timestamptz not null default now(),
  unique (class_schedule_id, date)
);

create table if not exists public.class_occurrence_extensions (
  id uuid primary key default gen_random_uuid(),
  occurrence_audit_id uuid not null references public.class_occurrence_audits(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  days_added integer not null default 1 check (days_added = 1),
  created_at timestamptz not null default now(),
  unique (occurrence_audit_id, enrollment_id)
);

create index if not exists idx_class_occurrence_audits_date
  on public.class_occurrence_audits (date desc, class_schedule_id);

alter table public.class_occurrence_audits enable row level security;
alter table public.class_occurrence_extensions enable row level security;

drop policy if exists class_occurrence_audits_staff_read on public.class_occurrence_audits;
create policy class_occurrence_audits_staff_read
  on public.class_occurrence_audits for select to authenticated
  using (is_staff());

drop policy if exists class_occurrence_extensions_staff_read on public.class_occurrence_extensions;
create policy class_occurrence_extensions_staff_read
  on public.class_occurrence_extensions for select to authenticated
  using (is_staff());

create or replace function public.audit_class_occurrence(
  p_class_schedule_id uuid,
  p_date date,
  p_status text,
  p_reason text,
  p_audited_by uuid
)
returns public.class_occurrence_audits
security definer
set search_path = public
language plpgsql
as $$
declare
  v_audit public.class_occurrence_audits%rowtype;
  v_link record;
  v_enrollment_id uuid;
  v_extension_id uuid;
  v_affected integer := 0;
begin
  if p_status not in ('normal', 'nullified', 'inactivated') then
    raise exception 'Status de auditoria invalido';
  end if;

  insert into public.class_occurrence_audits (
    class_schedule_id, date, status, reason, audited_by, audited_at
  )
  values (
    p_class_schedule_id,
    p_date,
    p_status,
    nullif(trim(coalesce(p_reason, '')), ''),
    p_audited_by,
    now()
  )
  on conflict (class_schedule_id, date)
  do update set
    status = excluded.status,
    reason = excluded.reason,
    audited_by = excluded.audited_by,
    audited_at = now()
  returning * into v_audit;

  if p_status = 'inactivated' then
    for v_link in
      select distinct student_id
      from public.student_classes
      where class_schedule_id = p_class_schedule_id
    loop
      v_enrollment_id := null;
      v_extension_id := null;

      select id
      into v_enrollment_id
      from public.enrollments
      where student_id = v_link.student_id
        and status in ('active', 'suspended', 'expired')
        and start_date <= p_date
        and end_date >= p_date
      order by created_at desc
      limit 1
      for update;

      if v_enrollment_id is null then
        continue;
      end if;

      insert into public.class_occurrence_extensions (
        occurrence_audit_id, enrollment_id, student_id
      )
      values (v_audit.id, v_enrollment_id, v_link.student_id)
      on conflict (occurrence_audit_id, enrollment_id) do nothing
      returning id into v_extension_id;

      if v_extension_id is not null then
        update public.enrollments
        set end_date = end_date + 1
        where id = v_enrollment_id;
      end if;
    end loop;
  else
    for v_link in
      select enrollment_id
      from public.class_occurrence_extensions
      where occurrence_audit_id = v_audit.id
    loop
      update public.enrollments
      set end_date = greatest(start_date, end_date - 1)
      where id = v_link.enrollment_id;
    end loop;

    delete from public.class_occurrence_extensions
    where occurrence_audit_id = v_audit.id;
  end if;

  select count(*)
  into v_affected
  from public.class_occurrence_extensions
  where occurrence_audit_id = v_audit.id;

  update public.class_occurrence_audits
  set affected_students = v_affected
  where id = v_audit.id
  returning * into v_audit;

  return v_audit;
end;
$$;

revoke all on function public.audit_class_occurrence(uuid, date, text, text, uuid) from public;
revoke all on function public.audit_class_occurrence(uuid, date, text, text, uuid) from authenticated;
grant execute on function public.audit_class_occurrence(uuid, date, text, text, uuid) to service_role;
