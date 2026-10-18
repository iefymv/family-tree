-- 0008_storage.sql — приватный bucket для фото и сканов.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 15728640, '{image/jpeg,image/png,image/webp,application/pdf}')
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Только участники читают; вставка только в people/...; UPDATE и DELETE — политик нет.
create policy documents_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select private.is_member()));

create policy documents_bucket_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select private.is_member())
    and (storage.foldername(name))[1] = 'people'
  );
