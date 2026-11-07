ALTER TABLE services ADD COLUMN name_ar TEXT NOT NULL DEFAULT '';

UPDATE services SET name_ar = CASE lower(trim(name))
  WHEN 'notary public' THEN 'كاتب العدل'
  WHEN 'certification' THEN 'التصديقات'
  WHEN 'mofa' THEN 'وزارة الخارجية'
  WHEN 'smart services' THEN 'الخدمات الذكية'
  WHEN 'typing services' THEN 'خدمات الطباعة'
  WHEN 'uae pass' THEN 'الهوية الرقمية UAE PASS'
  ELSE ''
END;
