// 꼬물상자: 관리자 알림 Edge Function
//
// DB 트리거가 부름:
//   - 새 동화·노래 요청 (requests.sql): { creation_id }
//   - 새 하드북 주문 (admin.sql):       { order_id }
// 알림 채널 (설정한 것으로 보냄, 둘 다 설정하면 둘 다):
//   - 이메일(Resend): RESEND_API_KEY + ADMIN_EMAIL (+ 선택: NOTIFY_FROM, 기본 onboarding@resend.dev)
//   - 디스코드: DISCORD_WEBHOOK_URL
// 선택: APP_BASE_URL (관리자 페이지 주소의 앞부분, 기본 GitHub Pages 주소)
//
// 누구나 이 함수를 부를 수는 있지만, 실제로 존재하는 10분 이내의 새 항목에 대해
// 한 번만 알림을 보내므로 악용해도 알림이 중복되거나 꾸며지지 않아요.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const KIND: Record<string, string> = { story: "동화", song: "노래" };
const FRESH_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST만 받아요" }, 405);

  let body: { order_id?: string; creation_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "요청 형식이 올바르지 않아요" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const base = (Deno.env.get("APP_BASE_URL") ?? "https://aldaltimes-creator.github.io/kkomul/app").replace(/\/$/, "");
  const when = (s: string) => new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const emailOf = async (id: string) => (await admin.auth.admin.getUserById(id)).data?.user?.email ?? "알 수 없음";

  let table: "book_orders" | "creations";
  let id: string;
  let subject: string;
  let lines: string[];

  if (body.creation_id) {
    const { data: c, error: cErr } = await admin
      .from("creations")
      .select("id, kind, status, request_note, created_at, notified_at, user_id, records(title, record_date), children(name)")
      .eq("id", body.creation_id)
      .maybeSingle();
    if (cErr) return json({ error: cErr.message }, 500);
    if (!c) return json({ skipped: "요청 없음" });
    if (c.notified_at) return json({ skipped: "이미 알림 보냄" });
    if (c.status !== "pending" || Date.now() - new Date(c.created_at).getTime() > FRESH_MS) return json({ skipped: "새 요청 아님" });

    const rec = c.records as unknown as { title: string; record_date: string } | null;
    const child = (c.children as unknown as { name: string } | null)?.name ?? "아이";
    table = "creations";
    id = c.id;
    subject = `[꼬물상자] 새 ${KIND[c.kind]} 요청 · ${child}`;
    lines = [
      `📝 새 ${KIND[c.kind]} 요청이 들어왔어요`,
      `아이: ${child}`,
      `기록: ${rec ? `${rec.record_date} 「${rec.title}」` : "–"}`,
      c.request_note ? `요청 메모: ${c.request_note}` : null,
      `회원: ${await emailOf(c.user_id)}`,
      `요청: ${when(c.created_at)}`,
      `확인하기: ${base}/admin-member.html?id=${c.user_id}#req-${c.id}`,
    ].filter(Boolean) as string[];
  } else if (body.order_id) {
    const { data: o, error: oErr } = await admin
      .from("book_orders")
      .select("id, cover_name, recipient, price, created_at, notified_at, user_id, creations(title)")
      .eq("id", body.order_id)
      .maybeSingle();
    if (oErr) return json({ error: oErr.message }, 500);
    if (!o) return json({ skipped: "주문 없음" });
    if (o.notified_at) return json({ skipped: "이미 알림 보냄" });
    if (Date.now() - new Date(o.created_at).getTime() > FRESH_MS) return json({ skipped: "오래된 주문" });

    const title = (o.creations as unknown as { title: string } | null)?.title ?? "동화";
    table = "book_orders";
    id = o.id;
    subject = `[꼬물상자] 새 하드북 주문 · 「${title}」`;
    // 주소·연락처는 알림에 넣지 않고 관리자 페이지에서만 보게 함
    lines = [
      "📚 새 하드북 주문이 들어왔어요",
      `동화: 「${title}」`,
      `표지 이름: ${o.cover_name}`,
      `받는 분: ${o.recipient}`,
      `회원: ${await emailOf(o.user_id)}`,
      `금액: ${o.price.toLocaleString("ko-KR")}원`,
      `접수: ${when(o.created_at)}`,
      `확인하기: ${base}/admin.html`,
    ];
  } else {
    return json({ error: "order_id 또는 creation_id가 필요해요" }, 400);
  }

  const text = lines.join("\n");
  const sent: string[] = [];
  const failed: string[] = [];

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  if (resendKey && adminEmail) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("NOTIFY_FROM") ?? "꼬물상자 <onboarding@resend.dev>",
        to: adminEmail.split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        text,
      }),
    });
    (r.ok ? sent : failed).push(`email ${r.status}`);
  }

  const discord = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (discord) {
    const r = await fetch(discord, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    (r.ok ? sent : failed).push(`discord ${r.status}`);
  }

  if (!sent.length && !failed.length) return json({ skipped: "알림 채널이 설정되지 않았어요" });
  if (sent.length) await admin.from(table).update({ notified_at: new Date().toISOString() }).eq("id", id);
  return json({ sent, failed });
});
