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


function hexToBytes(
  hex
) {

  if (
    !/^[0-9a-f]+$/i.test(
      hex
    ) ||
    hex.length %
      2 !==
      0
  ) {

    return null;

  }


  const bytes =
    new Uint8Array(
      hex.length /
      2
    );


  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {

    bytes[i] =
      parseInt(
        hex.slice(
          i * 2,
          i * 2 +
            2
        ),
        16
      );

  }


  return bytes;

}


function timingSafeEqual(
  a,
  b
) {

  if (
    !(a instanceof Uint8Array) ||
    !(b instanceof Uint8Array)
  ) {

    return false;

  }


  if (
    a.length !==
    b.length
  ) {

    return false;

  }


  let difference =
    0;


  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    difference |=
      a[i] ^
      b[i];

  }


  return difference ===
    0;

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


  const parts =
    signatureHeader
      .split(
        ","
      )
      .map(
        part =>
          part.trim()
      );


  const timestampPart =
    parts.find(
      part =>
        part.startsWith(
          "t="
        )
    );


  const signatures =
    parts
      .filter(
        part =>
          part.startsWith(
            "v1="
          )
      )
      .map(
        part =>
          part.slice(
            3
          )
      );


  if (
    !timestampPart ||
    !signatures.length
  ) {

    return false;

  }


  const timestamp =
    timestampPart.slice(
      2
    );


  /*
    Reject very old webhook signatures.
  */


  const timestampNumber =
    Number(
      timestamp
    );


  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {

    return false;

  }


  const currentSeconds =
    Math.floor(
      Date.now() /
      1000
    );


  if (
    Math.abs(
      currentSeconds -
      timestampNumber
    ) >
    300
  ) {

    return false;

  }


  const signedPayload =
    `${timestamp}.${payload}`;


  const key =
    await crypto.subtle.importKey(
      "raw",

      new TextEncoder().encode(
        secret
      ),

      {

        name:
          "HMAC",

        hash:
          "SHA-256",

      },

      false,

      [
        "sign"
      ]
    );


  const digest =
    await crypto.subtle.sign(
      "HMAC",

      key,

      new TextEncoder().encode(
        signedPayload
      )
    );


  const expected =
    new Uint8Array(
      digest
    );


  return signatures.some(
    signature => {

      const actual =
        hexToBytes(
          signature
        );


      return actual
        ? timingSafeEqual(
            expected,
            actual
          )
        : false;

    }
  );

}


async function supabasePatch(
  env,
  path,
  data
) {

  const response =
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/${path}`,
      {

        method:
          "PATCH",

        headers: {

          apikey:
            env.SUPABASE_SERVICE_ROLE_KEY,

          authorization:
            `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

          "content-type":
            "application/json",

          prefer:
            "return=representation",

          accept:
            "application/json",

        },

        body:
          JSON.stringify(
            data
          ),

      }
    );


  const text =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(
      `Supabase ${response.status}: ${text}`
    );

  }


  return text
    ? JSON.parse(
        text
      )
    : [];

}


export async function onRequestPost({
  request,
  env,
}) {

  try {


    if (
      !env.STRIPE_WEBHOOK_SECRET ||
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY
    ) {

      return json(
        {

          success:
            false,

          error:
            "Missing webhook configuration.",

        },
        500
      );

    }


    /*
      RAW BODY REQUIRED FOR
      STRIPE SIGNATURE VERIFICATION
    */


    const rawBody =
      await request.text();


    const signature =
      request.headers.get(
        "stripe-signature"
      );


    const valid =
      await verifyStripeSignature(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET
      );


    if (
      !valid
    ) {

      return json(
        {

          success:
            false,

          error:
            "Invalid Stripe signature.",

        },
        400
      );

    }


    const event =
      JSON.parse(
        rawBody
      );


    /*
      ACCEPT THE TWO STRIPE
      CHECKOUT PAYMENT EVENTS
    */


    if (
      event.type !==
        "checkout.session.completed" &&
      event.type !==
        "checkout.session.async_payment_succeeded"
    ) {

      return json({

        received:
          true,

        ignored:
          true,

      });

    }


    const session =
      event.data?.object;


    if (
      !session ||
      session.payment_status !==
        "paid"
    ) {

      return json({

        received:
          true,

        ignored:
          true,

      });

    }


    /*
      ONLY PROCESS THIS TEAM
    */


    const teamKey =
      session.metadata?.team_key;


    if (
      teamKey !==
      "ecb-sunrise-black-cooperstown"
    ) {

      return json({

        received:
          true,

        ignored:
          true,

      });

    }


    /*
      GENERAL TEAM DONATION
      DOES NOT TOUCH BASEBALLS
    */


    if (
      session.metadata?.purchase_type ===
      "general_donation"
    ) {

      return json({

        received:
          true,

        paid:
          true,

        type:
          "general_donation",

      });

    }


    /*
      PLAYER BASEBALL PURCHASE
    */


    const playerId =
      String(
        session.metadata?.player_id ||
        ""
      ).trim();


    const baseballCsv =
      String(
        session.metadata?.baseball_numbers ||
        ""
      ).trim();


    if (
      !playerId ||
      !baseballCsv
    ) {

      return json({

        received:
          true,

        ignored:
          true,

        reason:
          "Missing fundraiser metadata",

      });

    }


    const baseballNumbers =
      baseballCsv
        .split(
          ","
        )
        .map(
          value =>
            Number(
              value.trim()
            )
        )
        .filter(
          value =>
            Number.isInteger(
              value
            ) &&
            value >= 1 &&
            value <= 100
        );


    if (
      !baseballNumbers.length
    ) {

      return json({

        received:
          true,

        ignored:
          true,

      });

    }


    const anonymous =
      session.metadata?.anonymous ===
      "true";


    let donorName =
      typeof session.metadata?.donor_name ===
        "string"
        ? session.metadata
            .donor_name
            .trim()
        : "";


    if (
      anonymous ||
      !donorName
    ) {

      donorName =
        "Anonymous";

    }


    /*
      MARK ALL SELECTED BASEBALLS SOLD
    */


    const soldRows =
      await supabasePatch(
        env,

        `baseballs` +
        `?player_id=eq.${encodeURIComponent(
          playerId
        )}` +
        `&ball_number=in.(${baseballNumbers.join(
          ","
        )})`,

        {

          status:
            "sold",

          sold_at:
            new Date()
              .toISOString(),

          stripe_session_id:
            session.id,

          donor_name:
            donorName,

        }
      );


    return json({

      received:
        true,

      updatedRows:
        soldRows.length,

      baseballNumbers,

      donorName,

    });


  } catch (
    error
  ) {

    console.error(
      "Stripe webhook error:",
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
