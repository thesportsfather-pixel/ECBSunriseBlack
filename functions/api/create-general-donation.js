function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(
      data
    ),
    {

      status,

      headers: {

        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store",

      },

    }
  );

}


export async function onRequestPost({
  request,
  env,
}) {

  try {


    if (
      !env.STRIPE_SECRET_KEY
    ) {

      return json(
        {

          success:
            false,

          error:
            "Missing Stripe configuration.",

        },
        500
      );

    }


    const body =
      await request.json();


    const amount =
      Number(
        body.amount
      );


    const anonymous =
      Boolean(
        body.anonymous
      );


    let donorName =
      String(
        body.donorName ||
        ""
      )
        .trim()
        .replace(
          /\s+/g,
          " "
        );


    if (
      anonymous
    ) {

      donorName =
        "Anonymous";

    }


    if (
      !Number.isFinite(
        amount
      ) ||
      amount < 1
    ) {

      return json(
        {

          success:
            false,

          error:
            "Please enter a donation amount of at least $1.",

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

          success:
            false,

          error:
            "Please enter a donor name or select Remain Anonymous.",

        },
        400
      );

    }


    const amountCents =
      Math.round(
        amount *
        100
      );


    const origin =
      new URL(
        request.url
      ).origin;


    const successUrl =
      `${origin}/?general_donation=success`;


    const cancelUrl =
      `${origin}/?general_donation=canceled`;


    const params =
      new URLSearchParams();


    params.set(
      "mode",
      "payment"
    );


    params.set(
      "success_url",
      successUrl
    );


    params.set(
      "cancel_url",
      cancelUrl
    );


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
      String(
        amountCents
      )
    );


    params.set(
      "line_items[0][quantity]",
      "1"
    );


    /*
      METADATA
    */


    params.set(
      "metadata[team_key]",
      "ecb-sunrise-black-cooperstown"
    );


    params.set(
      "metadata[purchase_type]",
      "general_donation"
    );


    params.set(
      "metadata[donor_name]",
      donorName
    );


    params.set(
      "metadata[anonymous]",
      String(
        anonymous
      )
    );


    /*
      STRIPE
    */


    const stripeResponse =
      await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {

          method:
            "POST",

          headers: {

            authorization:
              `Bearer ${env.STRIPE_SECRET_KEY}`,

            "content-type":
              "application/x-www-form-urlencoded",

            accept:
              "application/json",

          },

          body:
            params.toString(),

        }
      );


    const stripeText =
      await stripeResponse.text();


    let session;


    try {

      session =
        JSON.parse(
          stripeText
        );

    } catch {

      return json(
        {

          success:
            false,

          error:
            "Stripe returned an invalid response.",

        },
        500
      );

    }


    if (
      !stripeResponse.ok
    ) {

      return json(
        {

          success:
            false,

          error:
            session?.error?.message ||
            "Unable to create donation checkout.",

        },
        stripeResponse.status
      );

    }


    return json({

      success:
        true,

      url:
        session.url,

      sessionId:
        session.id,

    });


  } catch (
    error
  ) {

    console.error(
      "General donation checkout error:",
      error
    );


    return json(
      {

        success:
          false,

        error:
          error instanceof Error
            ? error.message
            : String(
                error
              ),

      },
      500
    );

  }

}
