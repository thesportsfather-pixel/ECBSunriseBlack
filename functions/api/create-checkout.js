function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
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
      "Missing Supabase server configuration."
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

async function createStripeSession(
  env,
  values
) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      "Missing STRIPE_SECRET_KEY."
    );
  }

  const body =
    new URLSearchParams();

  Object.entries(values).forEach(
    ([key, value]) => {
      body.append(
        key,
        String(value)
      );
    }
  );

  const response = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",

      headers: {
        authorization:
          `Bearer ${env.STRIPE_SECRET_KEY}`,

        "content-type":
          "application/x-www-form-urlencoded"
      },

      body
    }
  );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      text
    );
  }

  return data;
}

export async function onRequestPost({
  request,
  env
}) {
  try {
    const body =
      await request.json();

    const teamKey =
      String(
        body.teamKey ||
        "ecb-sunrise-black"
      ).trim();

    const playerKey =
      String(
        body.playerKey ||
        ""
      ).trim();

    const anonymous =
      Boolean(
        body.anonymous
      );

    const donorName =
      anonymous
        ? "Anonymous"
        : String(
            body.donorName ||
            ""
          ).trim();

    const baseballNumbers =
      [
        ...new Set(
          (body.baseballs || [])
            .map(Number)
        )
      ]
        .filter(
          number =>
            Number.isInteger(number) &&
            number >= 1 &&
            number <= 100
        )
        .sort(
          (a, b) =>
            a - b
        );

    if (!playerKey) {
      return json(
        {
          success: false,
          error:
            "Player is required."
        },
        400
      );
    }

    if (!baseballNumbers.length) {
      return json(
        {
          success: false,
          error:
            "Choose at least one baseball."
        },
        400
      );
    }

    if (
      !anonymous &&
      !donorName
    ) {
      return json(
        {
          success: false,
          error:
            "Enter a donor name or choose Anonymous."
        },
        400
      );
    }

    const teams =
      await supabaseRequest(
        env,
        `teams?team_key=eq.${encodeURIComponent(teamKey)}&select=id,team_name&limit=1`
      );

    if (!teams?.length) {
      return json(
        {
          success: false,
          error:
            "Team not found."
        },
        404
      );
    }

    const team =
      teams[0];

    const players =
      await supabaseRequest(
        env,
        `players?team_id=eq.${encodeURIComponent(team.id)}&player_key=eq.${encodeURIComponent(playerKey)}&select=id,player_name,player_number&limit=1`
      );

    if (!players?.length) {
      return json(
        {
          success: false,
          error:
            "Player not found."
        },
        404
      );
    }

    const player =
      players[0];

    const baseballs =
      await supabaseRequest(
        env,
        `baseballs?player_id=eq.${encodeURIComponent(player.id)}&ball_number=in.(${baseballNumbers.join(",")})&select=ball_number,amount_cents,status`
      );

    const baseballMap =
      new Map(
        (baseballs || []).map(
          baseball => [
            Number(
              baseball.ball_number
            ),
            baseball
          ]
        )
      );

    const unavailable =
      baseballNumbers.filter(
        number => {
          const baseball =
            baseballMap.get(
              number
            );

          return (
            !baseball ||
            baseball.status !==
              "available"
          );
        }
      );

    if (unavailable.length) {
      return json(
        {
          success: false,

          error:
            `These baseballs are no longer available: ${unavailable
              .map(
                number =>
                  `#${number}`
              )
              .join(", ")}`
        },
        409
      );
    }

    const donationDollars =
      baseballNumbers.reduce(
        (total, number) =>
          total + number,
        0
      );

    // Stripe requires USD amounts in cents.
    const stripeAmount =
      donationDollars * 100;

    const origin =
      new URL(
        request.url
      ).origin;

    /*
      IMPORTANT:
      Customers now return to the ROOT page,
      not /fundraiser.html.
    */

    const successURL =
      `${origin}/?player=${encodeURIComponent(playerKey)}&payment=success&session_id={CHECKOUT_SESSION_ID}`;

    const cancelURL =
      `${origin}/?player=${encodeURIComponent(playerKey)}&payment=cancelled`;

    const session =
      await createStripeSession(
        env,
        {
          mode:
            "payment",

          "payment_method_types[0]":
            "card",

          "line_items[0][price_data][currency]":
            "usd",

          "line_items[0][price_data][product_data][name]":
            `ECB Sunrise Black - ${player.player_name} #${player.player_number}`,

          "line_items[0][price_data][product_data][description]":
            `Baseballs ${baseballNumbers
              .map(
                number =>
                  `#${number}`
              )
              .join(", ")}`,

          "line_items[0][price_data][unit_amount]":
            stripeAmount,

          "line_items[0][quantity]":
            1,

          success_url:
            successURL,

          cancel_url:
            cancelURL,

          "metadata[team_key]":
            teamKey,

          "metadata[player_key]":
            playerKey,

          "metadata[baseballs]":
            baseballNumbers.join(","),

          "metadata[donor_name]":
            donorName,

          "metadata[anonymous]":
            anonymous
              ? "true"
              : "false"
        }
      );

    return json({
      success: true,

      url:
        session.url,

      sessionId:
        session.id
    });

  } catch (error) {
    console.error(error);

    return json(
      {
        success: false,

        error:
          error.message ||
          "Unable to create checkout."
      },
      500
    );
  }
}
