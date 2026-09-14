import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { message?: string; context?: string } | null;
  const message = body?.message?.trim().slice(0, 1000);
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
  const escalation = needsHuman(message);
  const context = body?.context?.slice(0, 4000) ?? "";
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ reply: fallback(message), escalate: escalation, reason: escalation ? "This request needs a support specialist." : undefined });
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-2.5-flash"}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: "You are Kapde's concise, warm customer support assistant. Help only with shopping, products, delivery, orders, payments, and returns. Never invent an order status, price, stock level, refund, or policy. If information is missing, ask for the order ID or direct the customer to support. Keep replies under 80 words.\nStore context:\n" + context }] }, contents: [{ role: "user", parts: [{ text: message }] }], generationConfig: { temperature: 0.2 } }),
    });
    if (!response.ok) return NextResponse.json({ reply: fallback(message), escalate: escalation });
    const json = await response.json();
    const reply = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("").trim();
    return NextResponse.json({ reply: reply || fallback(message), escalate: escalation, reason: escalation ? "This request needs a support specialist." : undefined });
  } catch { return NextResponse.json({ reply: fallback(message), escalate: escalation }); }
}

function needsHuman(message: string) {
  return /refund|charged|payment failed|fraud|hacked|security|damaged|missing|lost|not received|late|overdue|wrong item|complaint|angry|cancel my order/i.test(message);
}

function fallback(message: string) {
  const q = message.toLowerCase();
  if (q.includes("return") || q.includes("refund")) return "I can help with a return. Please open Orders, select the order, and choose Return. Keep the item and packaging ready for pickup.";
  if (q.includes("deliver") || q.includes("ship")) return "Delivery timing depends on your pincode and live stock. Add the item to your cart and select your delivery location to see the current promise.";
  if (q.includes("order")) return "Please share your order ID, or open Orders from the top navigation to see the latest status.";
  return "I can help with products, delivery, orders, payments, and returns. What would you like to know?";
}
