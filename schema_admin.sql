-- ============================================================
-- 🗄️ ترقية قاعدة البيانات — لوحة تحكم الإدارة (Admin Dashboard)
-- شغّل هذا الملف بعد schema.sql الأصلي في Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1) جدول فقرات/عناوين الدرس (content_sections)
-- كل درس (سطر في contents) يمكن أن يحتوي على عدة فقرات وعناوين فرعية
-- ============================================================
CREATE TABLE content_sections (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id  INT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'paragraph' CHECK (type IN ('header', 'paragraph')),
    body        TEXT NOT NULL,
    "order"     INT DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2) جدول وسائط/روابط الدرس (content_media)
-- روابط فيديو يوتيوب أو ملفات PDF أو روابط عامة مرتبطة بالدرس
-- ============================================================
CREATE TABLE content_media (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_id  INT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'link' CHECK (type IN ('youtube', 'pdf', 'link')),
    title       TEXT,
    url         TEXT NOT NULL,
    "order"     INT DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_sections_content_id ON content_sections (content_id);
CREATE INDEX idx_content_media_content_id    ON content_media (content_id);

-- ============================================================
-- 🔒 تفعيل RLS على الجدولين الجديدين
-- ============================================================
ALTER TABLE content_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_media    ENABLE ROW LEVEL SECURITY;

-- كل مستخدم مسجل يقرأ فقرات/وسائط الدروس (نفس منطق contents_select)
CREATE POLICY "content_sections_select" ON content_sections
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "content_media_select" ON content_media
    FOR SELECT USING (auth.role() = 'authenticated');

-- المشرف فقط يضيف/يعدّل/يحذف
CREATE POLICY "content_sections_write" ON content_sections
    FOR ALL USING (public.is_current_user_supervisor())
    WITH CHECK (public.is_current_user_supervisor());

CREATE POLICY "content_media_write" ON content_media
    FOR ALL USING (public.is_current_user_supervisor())
    WITH CHECK (public.is_current_user_supervisor());

-- ============================================================
-- 3) السماح للمشرف بفتح تذكرة دعم نيابةً عن مستخدم آخر
-- (سياسة tickets_insert الأصلية تسمح فقط بـ auth.uid() = user_id)
-- ============================================================
CREATE POLICY "tickets_insert_supervisor" ON support_tickets
    FOR INSERT WITH CHECK (public.is_current_user_supervisor());

-- ============================================================
-- 4) صلاحيات إضافية للمشرف: تصرف كامل على تذاكر الدعم والتقدّم
-- (حذف تذاكر/رسائل غير مرغوبة، تصحيح سجلات تقدّم المستخدمين)
-- تنويه: عمداً لم تُضف أي صلاحية على journal_entries — تبقى خاصة
-- تماماً بصاحبها ولا يراها المشرف أبداً، بحسب تصميم المشروع الأصلي.
-- ============================================================
CREATE POLICY "tickets_delete_supervisor" ON support_tickets
    FOR DELETE USING (public.is_current_user_supervisor());

CREATE POLICY "ticket_messages_delete_supervisor" ON ticket_messages
    FOR DELETE USING (public.is_current_user_supervisor());

CREATE POLICY "progress_update_supervisor" ON user_progress
    FOR UPDATE USING (public.is_current_user_supervisor())
    WITH CHECK (public.is_current_user_supervisor());

CREATE POLICY "progress_delete_supervisor" ON user_progress
    FOR DELETE USING (public.is_current_user_supervisor());

-- ملاحظة: حذف صف من profiles لا يحذف حساب المصادقة في auth.users
-- (لا توجد علاقة CASCADE بهذا الاتجاه). لحذف مستخدم فعلياً استخدم
-- Supabase Dashboard → Authentication، وسيُحذف صف profiles تلقائياً
-- بفضل ON DELETE CASCADE المعرّف أصلاً على profiles.id.

-- ============================================================
-- ✅ ملاحظات تشغيل
-- ============================================================
-- 1) content_sections.type = 'header' → يُعرض كعنوان فرعي (h3) في واجهة الدرس.
--    content_sections.type = 'paragraph' → يُعرض كفقرة نصية عادية.
-- 2) content_media.type = 'youtube' → يُعرض كرابط فيديو (يفتح في تبويب جديد).
--    'pdf' → رابط تحميل ملف. 'link' → رابط عام (مقال، موقع، إلخ).
-- 3) الترتيب المعروض في واجهة المستخدم يعتمد على عمود "order" تصاعدياً.
-- 4) contents.body ما زال موجوداً كملخص/نص احتياطي يُعرض لو لم تتم إضافة
--    أي فقرات بعد لهذا الدرس (توافق خلفي مع الدروس القديمة).
-- ============================================================
