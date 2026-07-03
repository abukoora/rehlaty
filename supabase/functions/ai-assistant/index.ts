// ============================================================
// 🤖 Supabase Edge Function: ai-assistant
// يستخدم Mistral API للإجابة على أسئلة الطالب اعتماداً حصرياً على
// محتوى الدروس المخزَّن في قاعدة البيانات (فقرات + عناوين وسائط الفيديو/PDF).
//
// وضعان:
//   mode = "lesson"  → يجيب من محتوى درس واحد فقط (content_id مطلوب)
//   mode = "global"  → يبحث في كل الدروس المنشورة عبر كل المراحل
//
// إن لم يجد إجابة داخل المصادر المتاحة، يرجع answered=false ورسالة
// توجّه المستخدم للتواصل عبر الواتساب — الرسالة تُبنى من الخادم وليس
// من نص النموذج نفسه، لضمان ثبات الصياغة.
//
// النشر:
//   supabase functions deploy ai-assistant
//   supabase secrets set MISTRAL_API_KEY=xxxxx
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = Deno.env.get("MISTRAL_MODEL") || "mistral-small-latest";
const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const NO_ANSWER_MARKER = "NO_ANSWER_FOUND";
const FALLBACK_MESSAGE =
  "لم أجد إجابة على سؤالك داخل محتوى هذا الدرس (النص أو الفيديو أو الملفات المرفقة). " +
  "يمكنك التواصل مع المشرف مباشرة عبر زر الواتساب العائم للمساعدة الشخصية 🙏";

const RATE_LIMIT_PER_MINUTE = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!MISTRAL_API_KEY) {
    return json({ error: "المساعد الذكي غير مُفعّل حالياً (مفتاح Mistral غير مُعرَّف)." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "يجب تسجيل الدخول أولاً." }, 401);

  // عميل Supabase يعمل بصلاحيات المستخدم صاحب التوكن (يحترم RLS تلقائياً)
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "جلسة غير صالحة، سجّل الدخول من جديد." }, 401);
  const user = userData.user;

  let body: { mode?: string; content_id?: number; question?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "طلب غير صالح." }, 400);
  }

  const mode = body.mode === "global" ? "global" : "lesson";
  const question = (body.question || "").trim();
  if (!question) return json({ error: "اكتب سؤالاً أولاً." }, 400);
  if (question.length > 500) return json({ error: "السؤال طويل جداً، اختصره من فضلك." }, 400);
  if (mode === "lesson" && !body.content_id) return json({ error: "لم يتم تحديد الدرس." }, 400);

  // ---------------- Rate limiting (حماية بسيطة من إساءة الاستخدام) ----------------
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("ai_chat_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneMinuteAgo);
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    return json({ error: "عدد كبير من الأسئلة خلال وقت قصير، انتظر لحظات وحاول مجدداً." }, 429);
  }

  // ---------------- بناء سياق المصادر ----------------
  let contextText = "";
  let sourceLabel = "";

  try {
    if (mode === "lesson") {
      const contentId = Number(body.content_id);
      const { data: content, error: contentErr } = await supabase
        .from("contents")
        .select("id, title, body, category")
        .eq("id", contentId)
        .single();
      if (contentErr || !content) return json({ error: "لم يتم العثور على هذا الدرس." }, 404);

      const { data: sections } = await supabase
        .from("content_sections")
        .select("type, body, order")
        .eq("content_id", contentId)
        .order("order", { ascending: true });

      const { data: media } = await supabase
        .from("content_media")
        .select("type, title, order")
        .eq("content_id", contentId)
        .order("order", { ascending: true });

      sourceLabel = content.title;
      contextText = buildLessonContext(content, sections || [], media || []);
    } else {
      // وضع عام: بحث كلمات مفتاحية بسيط عبر كل الدروس المنشورة، ثم أخذ أفضل النتائج
      const keywords = extractKeywords(question);
      const orFilter = keywords.length
        ? keywords.map((k) => `title.ilike.%${k}%,body.ilike.%${k}%,category.ilike.%${k}%`).join(",")
        : null;

      let query = supabase.from("contents").select("id, title, body, category, stage").limit(6);
      if (orFilter) query = query.or(orFilter);
      const { data: matched } = await query;

      let candidateContents = matched || [];
      if (candidateContents.length === 0) {
        // لا تطابق مباشر بالكلمات المفتاحية: خذ آخر الدروس المنشورة كسياق احتياطي عام
        const { data: recent } = await supabase
          .from("contents")
          .select("id, title, body, category, stage")
          .order("created_at", { ascending: false })
          .limit(6);
        candidateContents = recent || [];
      }

      const contentIds = candidateContents.map((c) => c.id);
      const { data: allSections } = contentIds.length
        ? await supabase.from("content_sections").select("content_id, type, body, order").in("content_id", contentIds).order("order", { ascending: true })
        : { data: [] as any[] };
      const { data: allMedia } = contentIds.length
        ? await supabase.from("content_media").select("content_id, type, title, order").in("content_id", contentIds).order("order", { ascending: true })
        : { data: [] as any[] };

      sourceLabel = "عدة دروس";
      contextText = candidateContents
        .map((c) =>
          buildLessonContext(
            c,
            (allSections || []).filter((s: any) => s.content_id === c.id),
            (allMedia || []).filter((m: any) => m.content_id === c.id)
          )
        )
        .join("\n\n---\n\n");
    }
  } catch (e) {
    console.error(e);
    return json({ error: "حدث خطأ أثناء جلب محتوى الدروس." }, 500);
  }

  if (!contextText.trim()) {
    await logQuestion(supabase, user.id, mode === "lesson" ? Number(body.content_id) : null, question, null, false);
    return json({ answer: FALLBACK_MESSAGE, answered: false, sources: [] });
  }

  // ---------------- استدعاء Mistral ----------------
  const systemPrompt = buildSystemPrompt(mode);
  let modelText = "";
  try {
    const resp = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `المصادر المتاحة:\n\n${contextText}\n\n---\n\nسؤال الطالب: ${question}` },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Mistral error:", resp.status, errText);
      return json({ error: "تعذّر الوصول إلى المساعد الذكي حالياً، حاول لاحقاً." }, 502);
    }

    const data = await resp.json();
    modelText = data?.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error(e);
    return json({ error: "تعذّر الوصول إلى المساعد الذكي حالياً، حاول لاحقاً." }, 502);
  }

  const notFound = !modelText || modelText.includes(NO_ANSWER_MARKER);
  const finalAnswer = notFound ? FALLBACK_MESSAGE : modelText;

  await logQuestion(
    supabase,
    user.id,
    mode === "lesson" ? Number(body.content_id) : null,
    question,
    finalAnswer,
    !notFound
  );

  return json({
    answer: finalAnswer,
    answered: !notFound,
    sources: notFound ? [] : [sourceLabel],
  });
});

// ============================================================
// Helpers
// ============================================================

function buildLessonContext(content: any, sections: any[], media: any[]): string {
  const parts: string[] = [`## عنوان الدرس: ${content.title}`];
  if (content.category) parts.push(`التصنيف: ${content.category}`);

  if (sections.length > 0) {
    for (const s of sections) {
      const stripped = stripHtml(s.body);
      if (!stripped) continue;
      parts.push(s.type === "header" ? `### ${stripped}` : stripped);
    }
  } else if (content.body) {
    parts.push(stripHtml(content.body));
  }

  const videos = media.filter((m) => m.type === "youtube");
  const files = media.filter((m) => m.type !== "youtube");
  if (videos.length) parts.push(`فيديوهات مرفقة: ${videos.map((v) => v.title || "فيديو بدون عنوان").join("، ")}`);
  if (files.length) parts.push(`ملفات/روابط مرفقة: ${files.map((f) => f.title || f.type).join("، ")}`);

  // حد أقصى تقريبي لكل درس حتى لا يتضخم السياق في الوضع العام
  return parts.join("\n").slice(0, 2500);
}

function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractKeywords(question: string): string[] {
  const stopWords = new Set([
    "من", "في", "على", "عن", "الى", "إلى", "ما", "هل", "كيف", "لماذا", "متى", "أين",
    "التي", "الذي", "هذا", "هذه", "ذلك", "و", "أو", "ثم", "لا", "نعم", "أنا", "انا", "لي",
  ]);
  return question
    .replace(/[؟?!.,،]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 6);
}

function buildSystemPrompt(mode: "lesson" | "global"): string {
  const scope =
    mode === "lesson"
      ? "محتوى الدرس الحالي فقط (النص، عناوين الفقرات، وعناوين الفيديوهات/الملفات المرفقة)"
      : "محتوى الدروس المتاحة عبر مراحل التطبيق المختلفة";

  return `أنت مساعد تعليمي داخل تطبيق "رحلة الحياة الزوجية"، منصة إرشاد أسري إسلامي.
مهمتك: الإجابة على سؤال الطالب اعتماداً حصرياً على ${scope}، الموجود بين علامتي "المصادر المتاحة".

قواعد صارمة:
1) لا تستخدم أي معلومة من خارج المصادر المرسلة إليك، حتى لو كانت معرفتك العامة صحيحة.
2) إن لم تجد في المصادر ما يجيب على السؤال بشكل مباشر أو قريب، اكتب فقط الكلمة: ${NO_ANSWER_MARKER}
   بدون أي نص إضافي قبلها أو بعدها.
3) إذا وجدت إجابة، اكتبها بإيجاز ووضوح بالعربية الفصحى المبسطة، ثم أضف في نهاية إجابتك سطراً بصيغة:
   "المصدر: [عنوان الدرس]" (وإن كانت من فيديو أو ملف مرفق فاذكر اسمه أيضاً).
4) لا تُفتِ في مسائل شرعية دقيقة من عندك؛ انقل فقط ما ورد في المصادر، وإن كانت المصادر تنقل قولاً عن عالم أو مصدر فاذكره كما هو.
5) كن داعماً ولطيفاً في الأسلوب، فالمستخدم قد يكون في موقف حياتي حساس (خطوبة، زواج حديث، أو مشكلة أسرية).`;
}

async function logQuestion(
  supabase: any,
  userId: string,
  contentId: number | null,
  question: string,
  answer: string | null,
  answered: boolean
) {
  try {
    await supabase.from("ai_chat_logs").insert({
      user_id: userId,
      content_id: contentId,
      question,
      answer,
      answered,
    });
  } catch (e) {
    console.error("logQuestion failed:", e);
  }
}
