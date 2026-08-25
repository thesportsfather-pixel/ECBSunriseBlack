function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function supabaseGet(env, path) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${path}`,
    {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: "application/json",
      },
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : [];
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_SECRET_KEY) {
      return json(
        {
          success: false,
          error: "Missing Stripe configuration.",
        },
        500
      );
    }

    const body = await request.json();

    const checkoutType =
      String(body.checkoutType || "baseballs").trim();

    const anonymous =
      Boolean(body.anonymous);

    const donorName =
      anonymous
        ? "Anonymous"
        : String(body.donorName || "").trim();

    if (!donorName) {
      return json(
        {
          success: false,
          error: "A donor name is required or select anonymous.",
        },
        400
      );
    }

    const origin = new URL(request.url).origin;

    /*
      ========================================
      GENERAL TEAM DONATION
      ========================================
    */

    if (checkoutType === "general") {
      const amount =
        Number(body.amount);

      if (
        !Number.isFinite(amount) ||
        amount < 1
      ) {
        return json(
          {
            success: false,
            error: "Enter a valid donation amount.",
          },
          400
        );
      }

      const amountCents =
        Math.round(amount * 100);

      const successUrl =
        `${origin}/?payment=success`;

      const cancelUrl =
        `${origin}/?payment=cancelled`;

      const params =
        new URLSearchParams();

      params.set("mode", "payment");
      params.set("success_url", successUrl);
      params.set("cancel_url", cancelUrl);

      params.set(
        "line_items[0][price_data][currency]",
        "usd"
      );

      params.set(
        "line_items[0][price_data][product_data][name]",
        "ECB Sunrise Black - General Team Donation"
      );

      params.set(
        "line_items[0][price_data][product_data][description]",
        `Road to Cooperstown • Donor: ${donorName}`
      );

      params.set(
        "line_items[0][price_data][unit_amount]",
        String(amountCents)
      );

      params.set(
        "line_items[0][quantity]",
        "1"
      );

      params.set(
        "metadata[team_key]",
        "ecb-sunrise-black-cooperstown"
      );

      params.set(
        "metadata[checkout_type]",
        "general"
      );

      params.set(
        "metadata[donor_name]",
        donorName
      );

      params.set(
        "metadata[anonymous]",
        String(anonymous)
      );

      const stripeResponse =
        await fetch(
          "https://api.stripe.com/v1/checkout/sessions",
          {
            method: "POST",
            headers: {
              authorization:
                `Bearer ${env.STRIPE_SECRET_KEY}`,
              "content-type":
                "application/x-www-form-urlencoded",
            },
            body: params.toString(),
          }
        );

      const stripeText =
        await stripeResponse.text();

      const stripeData =
        JSON.parse(stripeText);

      if (!stripeResponse.ok) {
        throw new Error(
          `Stripe ${stripeResponse.status}: ${stripeText}`
        );
      }

      return json({
        success: true,
        sessionId: stripeData.id,
        url: stripeData.url,
      });
    }

    /*
      ========================================
      PLAYER BASEBALL CHECKOUT
      ========================================
    */

    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return json(
        {
          success: false,
          error: "Missing Supabase configuration.",
        },
        500
      );
    }

    const playerKey =
      String(body.playerKey || "").trim();

    const baseballNumbers =
      Array.isArray(body.baseballNumbers)
        ? body.baseballNumbers
            .map(Number)
            .filter(
              number =>
                Number.isInteger(number) &&
                number >= 1 &&
                number <= 100
            )
        : [];

    const uniqueBaseballNumbers =
      [...new Set(baseballNumbers)].sort(
        (a, b) => a - b
      );

    if (
      !playerKey ||
      !uniqueBaseballNumbers.length
    ) {
      return json(
        {
          success: false,
          error:
            "A player and at least one baseball are required.",
        },
        400
      );
    }

    const teams =
      await supabaseGet(
        env,
        "teams?team_key=eq.ecb-sunrise-black-cooperstown&select=id,team_key,team_name&limit=1"
      );

    if (!teams.length) {
      return json(
        {
          success: false,
          error: "Team not found.",
        },
        404
      );
    }

    const team = teams[0];

    const players =
      await supabaseGet(
        env,
        `players?team_id=eq.${encodeURIComponent(
          team.id
        )}&player_key=eq.${encodeURIComponent(
          playerKey
        )}&select=id,player_key,player_name,player_number&limit=1`
      );

    if (!players.length) {
      return json(
        {
          success: false,
          error: "Player not found.",
        },
        404
      );
    }

    const player = players[0];

    const baseballs =
      await supabaseGet(
        env,
        `baseballs?player_id=eq.${encodeURIComponent(
          player.id
        )}&ball_number=in.(${uniqueBaseballNumbers.join(
          ","
        )})&select=id,ball_number,amount_cents,status`
      );

    if (
      baseballs.length !==
      uniqueBaseballNumbers.length
    ) {
      return json(
        {
          success: false,
          error:
            "One or more selected baseballs could not be found.",
        },
        409
      );
    }

    const unavailable =
      baseballs.filter(
        ball =>
          ball.status !== "available"
      );

    if (unavailable.length) {
      return json(
        {
          success: false,
          error:
            `Baseball${
              unavailable.length === 1 ? "" : "s"
            } #${unavailable
              .map(ball => ball.ball_number)
              .join(", #")} ${
              unavailable.length === 1
                ? "is"
                : "are"
            } no longer available.`,
        },
        409
      );
    }

    const amountCents =
      baseballs.reduce(
        (sum, ball) =>
          sum +
          (
            Number(ball.amount_cents) ||
            Number(ball.ball_number) * 100
          ),
        0
      );

    const successUrl =
      `${origin}/fundraiser.html?player=${encodeURIComponent(
        playerKey
      )}&payment=success&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl =
      `${origin}/fundraiser.html?player=${encodeURIComponent(
        playerKey
      )}&payment=cancelled`;

    const params =
      new URLSearchParams();

    params.set("mode", "payment");
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);

    params.set(
      "line_items[0][price_data][currency]",
      "usd"
    );

    params.set(
      "line_items[0][price_data][product_data][name]",
      `ECB Sunrise Black - ${player.player_name}`
    );

    params.set(
      "line_items[0][price_data][product_data][description]",
      `Baseballs #${uniqueBaseballNumbers.join(
        ", #"
      )} • Donor: ${donorName}`
    );

    params.set(
      "line_items[0][price_data][unit_amount]",
      String(amountCents)
    );

    params.set(
      "line_items[0][quantity]",
      "1"
    );

    params.set(
      "metadata[team_key]",
      "ecb-sunrise-black-cooperstown"
    );

    params.set(
      "metadata[checkout_type]",
      "baseballs"
    );

    params.set(
      "metadata[player_id]",
      String(player.id)
    );

    params.set(
      "metadata[player_key]",
      player.player_key
    );

    params.set(
      "metadata[player_name]",
      player.player_name
    );

    params.set(
      "metadata[player_number]",
      String(player.player_number ?? "")
    );

    params.set(
      "metadata[baseball_numbers]",
      uniqueBaseballNumbers.join(",")
    );

    params.set(
      "metadata[donor_name]",
      donorName
    );

    params.set(
      "metadata[anonymous]",
      String(anonymous)
    );

    const stripeResponse =
      await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",
          headers: {
            authorization:
              `Bearer ${env.STRIPE_SECRET_KEY}`,
            "content-type":
              "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        }
      );

    const stripeText =
      await stripeResponse.text();

    const stripeData =
      JSON.parse(stripeText);

    if (!stripeResponse.ok) {
      throw new Error(
        `Stripe ${stripeResponse.status}: ${stripeText}`
      );
    }

    return json({
      success: true,
      sessionId: stripeData.id,
      url: stripeData.url,
      amountCents,
      baseballNumbers:
        uniqueBaseballNumbers,
    });

  } catch (error) {
    console.error(
      "Create checkout error:",
      error
    );

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500
    );
  }
}
