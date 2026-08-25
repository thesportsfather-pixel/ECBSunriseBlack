function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type":
        "application/json; charset=utf-8",

      "cache-control":
        "no-store"
    }
  });
}

async function supabaseRequest(
  env,
  path,
  options = {}
) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Missing Supabase configuration."
    );
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,

      headers: {
        apikey:
          env.SUPABASE_SERVICE_ROLE_KEY,

        authorization:
          `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

        accept:
          "application/json",

        ...(options.headers || {})
      }
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  return text
    ? JSON.parse(text)
    : null;
}

function bufferToHex(
  buffer
) {
  return [
    ...new Uint8Array(buffer)
  ]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}

async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  if (
    !signatureHeader ||
    !secret
  ) {
    return false;
  }

  const pieces =
    signatureHeader
      .split(",")
      .map(
        value =>
          value.trim()
      );

  const timestampPiece =
    pieces.find(
      value =>
        value.startsWith("t=")
    );

  const signatures =
    pieces
      .filter(
        value =>
          value.startsWith("v1=")
      )
      .map(
        value =>
          value.slice(3)
      );

  if (
    !timestampPiece ||
    !signatures.length
  ) {
    return false;
  }

  const timestamp =
    timestampPiece.slice(2);

  const signedPayload =
    `${timestamp}.${payload}`;

  const key =
    await crypto.subtle.importKey(
      "raw",

      new TextEncoder()
        .encode(secret),

      {
        name: "HMAC",
        hash: "SHA-256"
      },

      false,

      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",

      key,

      new TextEncoder()
        .encode(signedPayload)
    );

  const expected =
    bufferToHex(signature);

  return signatures.some(
    value =>
      value === expected
  );
}

async function finalizePayment(
  env,
  session
) {
  if (
    session.payment_status !==
    "paid"
  ) {
    return;
  }

  const metadata =
    session.metadata || {};

  const teamKey =
    metadata.team_key;

  const playerKey =
    metadata.player_key;

  const baseballNumbers =
    String(
      metadata.baseballs || ""
    )
      .split(",")
      .map(Number)
      .filter(
        n =>
          Number.isInteger(n) &&
          n >= 1 &&
          n <= 100
      );

  const donorName =
    metadata.anonymous === "true"
      ? "Anonymous"
      : (
          metadata.donor_name ||
          "Anonymous"
        );

  if (
    !teamKey ||
    !playerKey ||
    !baseballNumbers.length
  ) {
    throw new Error(
      "Stripe metadata is incomplete."
    );
  }

  const teams =
    await supabaseRequest(
      env,
      `teams?team_key=eq.${encodeURIComponent(teamKey)}&select=id&limit=1`
    );

  if (!teams?.length) {
    throw new Error(
      "Team not found."
    );
  }

  const team =
    teams[0];

  const players =
    await supabaseRequest(
      env,
      `players?team_id=eq.${encodeURIComponent(team.id)}&player_key=eq.${encodeURIComponent(playerKey)}&select=id&limit=1`
    );

  if (!players?.length) {
    throw new Error(
      "Player not found."
    );
  }

  const player =
    players[0];

  const rows =
    await supabaseRequest(
      env,
      `baseballs?player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${baseballNumbers.join(",")})&select=ball_number,status,stripe_session_id`
    );

  const updatable =
    (rows || []).filter(
      row =>
        row.status ===
          "available" ||
        row.stripe_session_id ===
          session.id
    );

  if (!updatable.length) {
    return;
  }

  await supabaseRequest(
    env,
    `baseballs?player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${updatable.map(row => row.ball_number).join(",")})`,
    {
      method: "PATCH",

      headers: {
        "content-type":
          "application/json",

        prefer:
          "return=minimal"
      },

      body:
        JSON.stringify({
          status: "sold",

          donor_name:
            donorName,

          sold_at:
            new Date()
              .toISOString(),

          stripe_session_id:
            session.id
        })
    }
  );
}

export async function onRequestPost({
  request,
  env
}) {
  try {
    if (
      !env.STRIPE_WEBHOOK_SECRET
    ) {
      throw new Error(
        "Missing STRIPE_WEBHOOK_SECRET."
      );
    }

    const payload =
      await request.text();

    const stripeSignature =
      request.headers.get(
        "stripe-signature"
      );

    const valid =
      await verifyStripeSignature(
        payload,
        stripeSignature,
        env.STRIPE_WEBHOOK_SECRET
      );

    if (!valid) {
      return json(
        {
          success: false,
          error:
            "Invalid Stripe signature."
        },
        400
      );
    }

    const event =
      JSON.parse(payload);

    if (
      event.type ===
        "checkout.session.completed" ||
      event.type ===
        "checkout.session.async_payment_succeeded"
    ) {
      await finalizePayment(
        env,
        event.data.object
      );
    }

    return json({
      received: true
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error:
          error.message ||
          "Webhook error."
      },
      500
    );
  }
}
