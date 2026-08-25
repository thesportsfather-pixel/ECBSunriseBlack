import {
  json,
  getTeam,
  getPlayer,
  supabaseRequest,
  stripeRequest
} from "./_shared.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const teamKey = String(body.teamKey || "ecb-sunrise").trim();
    const playerKey = String(body.playerKey || "").trim();
    const anonymous = Boolean(body.anonymous);
    const donorName = anonymous ? "Anonymous" : String(body.donorName || "").trim();
    const baseballs = [...new Set((body.baseballs || []).map(Number))]
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 100)
      .sort((a,b)=>a-b);

    if (!playerKey) return json({ success:false, error:"A player is required." }, 400);
    if (!baseballs.length) return json({ success:false, error:"Choose at least one baseball." }, 400);
    if (!anonymous && !donorName) return json({ success:false, error:"Enter a donor name or choose Anonymous." }, 400);

    const team = await getTeam(env, teamKey);
    const player = await getPlayer(env, team.id, playerKey);

    const rows = await supabaseRequest(
      env,
      `baseballs?team_id=eq.${encodeURIComponent(team.id)}&player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${baseballs.join(",")})&select=ball_number,status`
    );

    const byNumber = new Map((rows || []).map(r => [Number(r.ball_number), r]));
    const unavailable = baseballs.filter(n => !byNumber.has(n) || byNumber.get(n).status !== "available");
    if (unavailable.length) {
      return json({
        success:false,
        error:`These baseballs are no longer available: ${unavailable.map(n=>`#${n}`).join(", ")}. Please refresh and choose again.`
      }, 409);
    }

    const amountCents = baseballs.reduce((sum,n)=>sum+n,0) * 100;
    if (amountCents < 50) return json({ success:false, error:"Donation total is too small for Stripe." }, 400);

    const origin = new URL(request.url).origin;
    const successUrl = `${origin}/fundraiser.html?player=${encodeURIComponent(playerKey)}&payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/fundraiser.html?player=${encodeURIComponent(playerKey)}&payment=cancelled`;

    const session = await stripeRequest(env, "checkout/sessions", {
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": `ECB Sunrise — ${player.player_name} #${player.player_number}`,
      "line_items[0][price_data][product_data][description]": `Baseballs ${baseballs.map(n=>`#${n}`).join(", ")}`,
      "line_items[0][price_data][unit_amount]": amountCents,
      "line_items[0][quantity]": 1,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[team_key]": teamKey,
      "metadata[player_key]": playerKey,
      "metadata[baseballs]": baseballs.join(","),
      "metadata[donor_name]": donorName,
      "metadata[anonymous]": anonymous ? "true" : "false"
    });

    await supabaseRequest(env, "orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify({
        team_id: team.id,
        player_id: player.id,
        donor_name: donorName,
        anonymous,
        baseball_numbers: baseballs,
        amount_cents: amountCents,
        stripe_session_id: session.id,
        payment_status: "pending"
      })
    });

    return json({ success:true, url:session.url, sessionId:session.id });
  } catch (error) {
    console.error(error);
    return json({ success:false, error:error.message || "Unable to create checkout." }, 500);
  }
}
