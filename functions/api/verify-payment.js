import { json, stripeGet, finalizePaidSession } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId || !sessionId.startsWith("cs_")) {
      return json({ success:false, error:"A valid Stripe session_id is required." }, 400);
    }

    const session = await stripeGet(env, `checkout/sessions/${encodeURIComponent(sessionId)}`);
    const result = await finalizePaidSession(env, session);

    return json({ success:true, ...result });
  } catch (error) {
    console.error(error);
    return json({ success:false, error:error.message || "Unable to verify payment." }, 500);
  }
}
