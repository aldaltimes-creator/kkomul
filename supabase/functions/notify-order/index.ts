// 꼬물상자: 새 하드북 주문이 들어오면 관리자에게 알림을 보내는 Edge Function
//
// 호출: book_orders 에 행이 추가되면 DB 트리거(admin.sql)가 { order_id } 를 보냄
// 알림 채널 (둘 중 설정한 것으로 보냄, 둘 다 설정하면 둘 다):
//   - 디스코드: DISCORD_WEBHOOK_URL
//   - 이메일(Resend): RESEND_API_KEY + ADMIN_EMAIL (+ 선택: NOTIFY_FROM, 기본 onboarding@resend.dev)
// 선택: ADMIN_PAGE_URL (알림에 넣을 관리자 페이지 주소)
//
// 누구나 이 함수를 부를 수는 있지만, 실제로 존재하는 10분 이내의 새 주문에 대해
// 한 번만 알림을 보내므로 악용해도 알림이 중복되거나 꾸며지지 않아요.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST만 받아요" }, 405);

  let orderId: string | undefined;
  try {
    orderId = (await req.json()).order_id;
  } catch {
    return json({ error: "요청 형식이 올바르지 않아요" }, 400);
  }
  if (!orderId) return json({ error: "order_id가 필요해요" }, 400);

  // 서버 안에서만 쓰는 관리자 권한 클라이언트 (자동으로 들어 있는 환경 변수)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: order, error } = await admin
    .from("book_orders")
    .select("id, cover_name, recipient, price, created_at, notified_at, user_id, creations(title)")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return json({ skipped: "주문 없음" });
  if (order.notified_at) return json({ skipped: "이미 알림 보냄" });
  if (Date.now() - new Date(order.created_at).getTime() > 10 * 60 * 1000) return json({ skipped: "오래된 주문" });

  const { data: userRes } = await admin.auth.admin.getUserById(order.user_id);
  const title = (order.creations as unknown as { title: string } | null)?.title ?? "동화";
  const page = Deno.env.get("ADMIN_PAGE_URL") ?? "https://aldaltimes-creator.github.io/kkomul/app/admin.html";
  const when = new Date(order.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  // 주소·연락처는 알림에 넣지 않고 관리자 페이지에서만 보게 함
  const lines = [
    "📚 새 하드북 주문이 들어왔어요",
    `동화: 「${title}」`,
    `표지 이름: ${order.cover_name}`,
    `받는 분: ${order.recipient}`,
    `주문한 계정: ${userRes?.user?.email ?? "알 수 없음"}`,
    `금액: ${order.price.toLocaleString("ko-KR")}원`,
    `접수: ${when}`,
    `확인하기: ${page}`,
  ];
  const text = lines.join("\n");
  const sent: string[] = [];
  const failed: string[] = [];

  const discord = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (discord) {
    const r = await fetch(discord, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    (r.ok ? sent : failed).push(`discord ${r.status}`);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  if (resendKey && adminEmail) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("NOTIFY_FROM") ?? "꼬물상자 <onboarding@resend.dev>",
        to: adminEmail.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `[꼬물상자] 새 하드북 주문 · 「${title}」`,
        text,
      }),
    });
    (r.ok ? sent : failed).push(`email ${r.status}`);
  }

  if (!sent.length && !failed.length) return json({ skipped: "알림 채널이 설정되지 않았어요" });
  if (sent.length) {
    await admin.from("book_orders").update({ notified_at: new Date().toISOString() }).eq("id", order.id);
  }
  return json({ sent, failed });
});
