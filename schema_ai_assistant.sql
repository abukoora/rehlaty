-- ============================================================
-- 🗄️ ترقية قاعدة البيانات — المساعد الذكي (Mistral) + جدولة نشر الدروس
-- شغّل هذا الملف بعد schema.sql و schema_admin.sql في Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1) تاريخ نشر الدرس (contents.published_at)
-- NULL = مسودة غير منشورة. تاريخ في المستقبل = مجدول. تاريخ في الماضي/الآن = منشور.
-- ============================================================
ALTER TABLE contents ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- الدروس القديمة الموجودة فعلاً تُعتبر منشورة من تاريخ إنشائها حتى لا تختفي فجأة
UPDATE contents SET published_at = created_at WHERE published_at IS NULL;

-- ============================================================
-- 2) تحديث سياسات القراءة (RLS) لتُخفي الدروس غير المنشورة/المجدولة
--    عن المستخدم العادي، مع بقاء رؤيتها الكاملة للمشرف (لأغراض المراجعة)
-- ============================================================
DROP POLICY IF EXISTS "contents_select" ON contents;
CREATE POLICY "contents_select" ON contents
    FOR SELECT USING (
        public.is_current_user_supervisor()
        OR (published_at IS NOT NULL AND published_at <= NOW())
    );

DROP POLICY IF EXISTS "content_sections_select" ON content_sections;
CREATE POLICY "content_sections_select" ON content_sections
    FOR SELECT USING (
        public.is_current_user_supervisor()
        OR EXISTS (
            SELECT 1 FROM contents c
            WHERE c.id = content_sections.content_id
            AND c.published_at IS NOT NULL AND c.published_at <= NOW()
        )
    );

DROP POLICY IF EXISTS "content_media_select" ON content_media;
CREATE POLICY "content_media_select" ON content_media
    FOR SELECT USING (
        public.is_current_user_supervisor()
        OR EXISTS (
            SELECT 1 FROM contents c
            WHERE c.id = content_media.content_id
            AND c.published_at IS NOT NULL AND c.published_at <= NOW()
        )
    );

CREATE INDEX IF NOT EXISTS idx_contents_published_at ON contents (published_at);

-- ============================================================
-- 3) سجل أسئلة المساعد الذكي (ai_chat_logs)
--    - يُستخدم لمنع إساءة الاستخدام (Rate limiting) داخل الـ Edge Function
--    - يساعد المشرف على معرفة الأسئلة التي لم يستطع المساعد الإجابة عنها
--      (فجوات المحتوى) عبر عمود answered
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_chat_logs (
    id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      UUID REFERENCES profiles(id) ON DELETE CASCADE,
    content_id   INT REFERENCES contents(id) ON DELETE SET NULL, -- NULL = سؤال عام من الصفحة الرئيسية
    question     TEXT NOT NULL,
    answer       TEXT,
    answered     BOOLEAN DEFAULT TRUE, -- FALSE = لم يجد إجابة داخل المصادر وتم توجيه المستخدم للواتساب
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_user_id    ON ai_chat_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_user_time  ON ai_chat_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_content_id ON ai_chat_logs (content_id);

ALTER TABLE ai_chat_logs ENABLE ROW LEVEL SECURITY;

-- المستخدم يشوف أسئلته فقط، والمشرف يشوف كل الأسئلة (لتحسين المحتوى)
CREATE POLICY "ai_chat_logs_select" ON ai_chat_logs
    FOR SELECT USING (auth.uid() = user_id OR public.is_current_user_supervisor());

-- الإدراج يتم فقط عبر الـ Edge Function باستخدام Service Role
-- (لا تُمنح صلاحية INSERT مباشرة من الواجهة الأمامية لمنع تزوير السجلات)
CREATE POLICY "ai_chat_logs_insert_own" ON ai_chat_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- ✅ ملاحظات تشغيل
-- ============================================================
-- 1) عند إنشاء/تعديل درس من لوحة التحكم بدون تحديد "تاريخ النشر"،
--    يبقى published_at = NULL وبالتالي الدرس مسودة لا يظهر لأحد
--    عدا المشرف. لجعله يظهر فوراً، اختر تاريخ اليوم/الوقت الحالي.
-- 2) لجدولة نشر مستقبلي: اختر تاريخ/وقت لاحق — سيظهر الدرس تلقائياً
--    بمجرد وصول ذلك الوقت (لا حاجة لأي إجراء إضافي، لأن الشرط
--    published_at <= NOW() يُقيَّم في كل قراءة).
-- 3) هذا الملف لا يغيّر شيئاً بخصوص journal_entries (تبقى خاصة تماماً
--    ولا يستخدمها المساعد الذكي إطلاقاً كمصدر إجابات).
-- ============================================================
