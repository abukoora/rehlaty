-- ============================================================
-- 🗄️ قاعدة بيانات منصة "رحلة الحياة الزوجية" — النسخة النهائية
-- مطابقة تماماً للهيكل الأصلي المرسل + تحسينات مقترحة (Indexes)
-- جاهزة للنسخ واللصق في Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1) جدول الملفات الشخصية (profiles)
-- ============================================================
CREATE TABLE profiles (
    id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name      TEXT,
    gender            TEXT DEFAULT 'male' CHECK (gender IN ('male', 'female')),
    stage             TEXT DEFAULT 'pre_engagement' CHECK (stage IN ('pre_engagement', 'engaged', 'newlywed', 'settled')),
    whatsapp_number   TEXT,
    is_supervisor     BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2) جدول المحتوى (contents)
-- ============================================================
CREATE TABLE contents (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    stage       TEXT NOT NULL CHECK (stage IN ('pre_engagement', 'engaged', 'newlywed', 'settled')),
    category    TEXT,
    gender      TEXT DEFAULT 'both' CHECK (gender IN ('male', 'female', 'both')),
    "order"     INT DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3) جدول تقدم المستخدم (user_progress)
-- ============================================================
CREATE TABLE user_progress (
    id            INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
    content_id    INT REFERENCES contents(id) ON DELETE CASCADE,
    completed     BOOLEAN DEFAULT TRUE,
    completed_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, content_id)
);

-- ============================================================
-- 4) جدول المذكرات الخاصة (journal_entries)
-- ============================================================
CREATE TABLE journal_entries (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title       TEXT,
    body        TEXT,
    mood        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5) جدول تذاكر الدعم (support_tickets)
-- ============================================================
CREATE TABLE support_tickets (
    id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        UUID REFERENCES profiles(id) ON DELETE CASCADE,
    supervisor_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    subject        TEXT NOT NULL,
    status         TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5.ب) جدول ردود التذاكر (ticket_messages)
-- ============================================================
CREATE TABLE ticket_messages (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id   INT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ⚡ الفهارس (Indexes) — إضافة يدوية لتسريع الاستعلامات المتكررة
-- (الـ Foreign Key لا يُنشئ index تلقائياً في Postgres)
-- ============================================================
CREATE INDEX idx_contents_stage_gender      ON contents (stage, gender);
CREATE INDEX idx_user_progress_user_id      ON user_progress (user_id);
CREATE INDEX idx_user_progress_content_id   ON user_progress (content_id);
CREATE INDEX idx_journal_user_id            ON journal_entries (user_id);
CREATE INDEX idx_tickets_user_id            ON support_tickets (user_id);
CREATE INDEX idx_tickets_supervisor_id      ON support_tickets (supervisor_id);
CREATE INDEX idx_ticket_messages_ticket_id  ON ticket_messages (ticket_id);
CREATE INDEX idx_ticket_messages_sender_id  ON ticket_messages (sender_id);

-- ============================================================
-- 🔧 الدالة والمشغل لإنشاء الملف الشخصي تلقائياً عند التسجيل
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, gender, stage)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'مستخدم جديد'),
        COALESCE(NEW.raw_user_meta_data ->> 'gender', 'male'),
        'pre_engagement'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 🔒 دالة مساعدة: هل المستخدم الحالي مشرف؟
-- (تُستخدم داخل الـ Policies لتفادي التكرار والـ recursive RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_current_user_supervisor()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        (SELECT is_supervisor FROM public.profiles WHERE id = auth.uid()),
        FALSE
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- 🔒 تفعيل RLS على كل الجداول
-- ============================================================
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages   ENABLE ROW LEVEL SECURITY;

-- ---------- profiles ----------
-- كل مستخدم يشوف بياناته، والمشرف يشوف الكل
CREATE POLICY "profiles_select" ON profiles
    FOR SELECT USING (auth.uid() = id OR public.is_current_user_supervisor());

-- المستخدم يعدّل بياناته لكن ممنوع يرقّي نفسه لمشرف
CREATE POLICY "profiles_update_self" ON profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        AND (is_supervisor = FALSE OR public.is_current_user_supervisor())
    );

-- المشرف فقط يقدر يغيّر is_supervisor لأي حد
CREATE POLICY "profiles_update_supervisor" ON profiles
    FOR UPDATE USING (public.is_current_user_supervisor());

-- ---------- contents ----------
-- الكل يقرأ المحتوى (عام لكل المسجلين — الفلترة حسب stage/gender تتم في الواجهة)
CREATE POLICY "contents_select" ON contents
    FOR SELECT USING (auth.role() = 'authenticated');

-- المشرف فقط يضيف/يعدّل/يحذف المحتوى
CREATE POLICY "contents_write" ON contents
    FOR ALL USING (public.is_current_user_supervisor())
    WITH CHECK (public.is_current_user_supervisor());

-- ---------- user_progress ----------
CREATE POLICY "progress_select" ON user_progress
    FOR SELECT USING (auth.uid() = user_id OR public.is_current_user_supervisor());

CREATE POLICY "progress_insert" ON user_progress
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "progress_delete" ON user_progress
    FOR DELETE USING (auth.uid() = user_id);

-- ---------- journal_entries (خاصة تماماً، حتى المشرف مايشوفهاش) ----------
CREATE POLICY "journal_select" ON journal_entries
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "journal_insert" ON journal_entries
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "journal_update" ON journal_entries
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "journal_delete" ON journal_entries
    FOR DELETE USING (auth.uid() = user_id);

-- ---------- support_tickets ----------
CREATE POLICY "tickets_select" ON support_tickets
    FOR SELECT USING (
        auth.uid() = user_id
        OR auth.uid() = supervisor_id
        OR public.is_current_user_supervisor()
    );

CREATE POLICY "tickets_insert" ON support_tickets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tickets_update" ON support_tickets
    FOR UPDATE USING (
        auth.uid() = user_id OR public.is_current_user_supervisor()
    );

-- ---------- ticket_messages ----------
-- الرسالة تظهر بس لصاحب التذكرة أو المشرف المسؤول عنها
CREATE POLICY "ticket_messages_select" ON ticket_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM support_tickets t
            WHERE t.id = ticket_messages.ticket_id
            AND (t.user_id = auth.uid() OR t.supervisor_id = auth.uid() OR public.is_current_user_supervisor())
        )
    );

CREATE POLICY "ticket_messages_insert" ON ticket_messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM support_tickets t
            WHERE t.id = ticket_messages.ticket_id
            AND (t.user_id = auth.uid() OR t.supervisor_id = auth.uid() OR public.is_current_user_supervisor())
        )
    );

-- ============================================================
-- ✅ ملاحظات تشغيل مهمة (اقرأها قبل الربط بالواجهة)
-- ============================================================
-- 1) نسبة إتمام المرحلة تُحسب في الواجهة:
--    COUNT(user_progress WHERE completed=true AND user_id=X)
--    ÷ COUNT(contents WHERE stage = مرحلة_المستخدم AND gender IN (جنس_المستخدم,'both'))
--
-- 2) عند جلب contents في الواجهة، لازم تضيف WHERE يدوي:
--    .eq('stage', userStage).in('gender', [userGender, 'both'])
--    لأن RLS تسمح بعرض كل الصفوف لأي مستخدم مسجل.
--
-- 3) whatsapp_number في profiles يمكن استخدامه لاحقاً لعرض رقم
--    المشرف المسؤول تلقائياً في زر الواتساب العائم بدل رقم ثابت.
-- ============================================================
