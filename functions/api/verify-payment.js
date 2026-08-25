function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequestGet({
  request,
  env,
}) {
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

    const url = new URL(request.url);

    const sessionId =
      (
        url.searchParams.get("session_id") ||
        ""
      ).trim();

    if (!sessionId) {
      return json(
        {
          success: false,
          error: "A valid Stripe session_id is required.",
        },
        400
      );
    }

    /*
      Retrieve Checkout Session from Stripe
    */

    const stripeResponse =
      await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
          sessionId
        )}`,
        {
          method: "GET",
          headers: {
            authorization:
              `Bearer ${env.STRIPE_SECRET_KEY}`,
          },
        }
      );

    const stripeText =
      await stripeResponse.text();

    let session;

    try {
      session =
        JSON.parse(stripeText);
    } catch {
      session = null;
    }

    if (
      !stripeResponse.ok ||
      !session
    ) {
      return json(
        {
          success: false,
          error:
            `Stripe ${stripeResponse.status}: ${stripeText}`,
        },
        stripeResponse.status || 500
      );
    }

    /*
      Make sure this payment belongs
      to ECB Sunrise Black
    */

    const metadata =
      session.metadata || {};

    if (
      metadata.team_key !==
      "ecb-sunrise-black-cooperstown"
    ) {
      return json(
        {
          success: false,
          error:
            "This Stripe payment does not belong to ECB Sunrise Black.",
        },
        400
      );
    }

    const paid =
      session.payment_status === "paid";

    /*
      Parse baseball numbers
    */

    const baseballNumbers =
      String(
        metadata.baseball_numbers || ""
      )
        .split(",")
        .map((value) =>
          Number(value.trim())
        )
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 1 &&
            value <= 100
        );

    return json({
      success: true,

      paid,

      paymentStatus:
        session.payment_status,

      sessionId:
        session.id,

      playerKey:
        metadata.player_key || null,

      playerName:
        metadata.player_name || null,

      playerNumber:
        metadata.player_number || null,

      baseballNumbers,

      donorName:
        metadata.donor_name ||
        "Anonymous",
    });

  } catch (error) {
    console.error(
      "Verify payment error:",
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
