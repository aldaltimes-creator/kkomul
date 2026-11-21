-- 기존 프로젝트의 비공개 작품 저장소에 PDF 업로드를 허용합니다.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
where id = 'creation-media'
  and allowed_mime_types is not null
  and not ('application/pdf' = any(allowed_mime_types));
