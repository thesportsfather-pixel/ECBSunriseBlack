export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing server configuration: ${missing.join(", ")}`);
  }
}

export async function supabaseRequest(env, path, options = {}) {
  requireEnv(env, ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function getTeam(env, teamKey) {
  const rows = await supabaseRequest(
    env,
    `teams?team_key=eq.${encodeURIComponent(teamKey)}&select=id,team_key,team_name,goal_cents&limit=1`
  );
  if (!rows?.length) throw new Error(`Team not found: ${teamKey}`);
  return rows[0];
}

export async function getPlayer(env, teamId, playerKey) {
  const rows = await supabaseRequest(
    env,
    `players?team_id=eq.${encodeURIComponent(teamId)}&player_key=eq.${encodeURIComponent(playerKey)}&select=id,team_id,player_key,player_name,player_number&limit=1`
  );
  if (!rows?.length) throw new Error(`Player not found: ${playerKey}`);
  return rows[0];
}

export function formEncode(obj) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  return params.toString();
}

export async function stripeRequest(env, path, body) {
  requireEnv(env, ["STRIPE_SECRET_KEY"]);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: formEncode(body)
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    throw new Error(`Stripe ${response.status}: ${data?.error?.message || text}`);
  }
  return data;
}

export async function stripeGet(env, path) {
  requireEnv(env, ["STRIPE_SECRET_KEY"]);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    throw new Error(`Stripe ${response.status}: ${data?.error?.message || text}`);
  }
  return data;
}

export function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").map(x => x.trim());
  const timestampPart = parts.find(x => x.startsWith("t="));
  const signatures = parts.filter(x => x.startsWith("v1=")).map(x => x.slice(3));
  if (!timestampPart || !signatures.length) return false;

  const timestamp = timestampPart.slice(2);
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = bytesToHex(digest);
  return signatures.some(sig => sig === expected);
}

export async function finalizePaidSession(env, session) {
  const sessionId = session.id;
  const paymentStatus = session.payment_status;
  if (paymentStatus !== "paid") {
    return { paid: false, updatedRows: 0, playerKey: session.metadata?.player_key || null };
  }

  const metadata = session.metadata || {};
  const teamKey = metadata.team_key;
  const playerKey = metadata.player_key;
  const baseballNumbers = (metadata.baseballs || "")
    .split(",")
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 100);

  if (!teamKey || !playerKey || !baseballNumbers.length) {
    throw new Error("Stripe session metadata is incomplete.");
  }

  const team = await getTeam(env, teamKey);
  const player = await getPlayer(env, team.id, playerKey);
  const donorName = metadata.anonymous === "true"
    ? "Anonymous"
    : (metadata.donor_name || "Anonymous");

  const rows = await supabaseRequest(
    env,
    `baseballs?team_id=eq.${encodeURIComponent(team.id)}&player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${baseballNumbers.join(",")})&select=id,ball_number,status,stripe_session_id`,
    { method: "GET" }
  );

  const updatable = (rows || []).filter(row =>
    row.status === "available" || row.stripe_session_id === sessionId
  );

  if (updatable.length) {
    await supabaseRequest(
      env,
      `baseballs?team_id=eq.${encodeURIComponent(team.id)}&player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${updatable.map(r=>r.ball_number).join(",")})`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "sold",
          donor_name: donorName,
          sold_at: new Date().toISOString(),
          stripe_session_id: sessionId
        })
      }
    );
  }

  await supabaseRequest(
    env,
    `orders?stripe_session_id=eq.${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify({
        payment_status: "paid",
        paid_at: new Date().toISOString()
      })
    }
  );

  return {
    paid: true,
    playerKey,
    baseballNumbers,
    donorName,
    updatedRows: updatable.length
  };
}
