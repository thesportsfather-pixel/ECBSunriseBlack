function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
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

async function getStripeSession(
  env,
  sessionId
) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      "Missing STRIPE_SECRET_KEY."
    );
  }

  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        authorization:
          `Bearer ${env.STRIPE_SECRET_KEY}`
      }
    }
  );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Unable to retrieve Stripe session."
    );
  }

  return data;
}

async function finalizePayment(
  env,
  session
) {
  if (
    session.payment_status !==
    "paid"
  ) {
    return {
      paid: false,
      updatedRows: 0
    };
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

  const team = teams[0];

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
      `baseballs?player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${baseballNumbers.join(",")})&select=id,ball_number,status,stripe_session_id`
    );

  const updatable =
    (rows || []).filter(
      row =>
        row.status ===
          "available" ||
        row.stripe_session_id ===
          session.id
    );

  if (updatable.length) {
    const numbers =
      updatable
        .map(
          row =>
            row.ball_number
        )
        .join(",");

    await supabaseRequest(
      env,
      `baseballs?player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${numbers})`,
      {
        method: "PATCH",

        headers: {
          "content-type":
            "application/json",

          prefer:
            "return=representation"
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

  return {
    paid: true,
    playerKey,
    baseballNumbers,
    donorName,
    updatedRows:
      updatable.length
  };
}

export async function onRequestGet({
  request,
  env
}) {
  try {
    const url =
      new URL(
        request.url
      );

    const sessionId =
      url.searchParams.get(
        "session_id"
      );

    if (
      !sessionId ||
      !sessionId.startsWith("cs_")
    ) {
      return json(
        {
          success: false,
          error:
            "A valid Stripe session_id is required."
        },
        400
      );
    }

    const session =
      await getStripeSession(
        env,
        sessionId
      );

    const result =
      await finalizePayment(
        env,
        session
      );

    return json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,
        error:
          error.message ||
          "Unable to verify payment."
      },
      500
    );
  }
}
