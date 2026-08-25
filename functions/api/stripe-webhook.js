function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function hexToBytes(hex) {
  if (
    !/^[0-9a-f]+$/i.test(hex) ||
    hex.length % 2 !== 0
  ) {
    return null;
  }

  const bytes =
    new Uint8Array(hex.length / 2);

  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {
    bytes[i] =
      parseInt(
        hex.slice(
          i * 2,
          i * 2 + 2
        ),
        16
      );
  }

  return bytes;
}

async function verifyStripeSignature(
  payload,
  signatureHeader,
  secret
) {
  if (
    !payload ||
    !signatureHeader ||
    !secret
  ) {
    return false;
  }

  const parts =
    signatureHeader.split(",");

  const timestampPart =
    parts.find(
      part =>
        part.startsWith("t=")
    );

  const signatureParts =
    parts
      .filter(
        part =>
          part.startsWith("v1=")
      )
      .map(
        part =>
          part.slice(3)
      );

  if (
    !timestampPart ||
    !signatureParts.length
  ) {
    return false;
  }

  const timestamp =
    timestampPart.slice(2);

  const signedPayload =
    `${timestamp}.${payload}`;

  const encoder =
    new TextEncoder();

  const cryptoKey =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

  const signatureBuffer =
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(
        signedPayload
      )
    );

  const expectedSignature =
    Array.from(
      new Uint8Array(
        signatureBuffer
      )
    )
      .map(
        byte =>
          byte
            .toString(16)
            .padStart(2, "0")
      )
      .join("");

  return signatureParts.includes(
    expectedSignature
  );
}

async function supabasePatch(
  env,
  path,
  body
) {
  const response =
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/${path}`,
      {
        method: "PATCH",

        headers: {
          apikey:
            env.SUPABASE_SERVICE_ROLE_KEY,

          authorization:
            `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

          "content-type":
            "application/json",

          prefer:
            "return=representation",
        },

        body:
          JSON.stringify(body),
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
          success: false,
          error:
            "Missing server configuration.",
        },
        500
      );
    }

    /*
      IMPORTANT:
      Stripe signature verification
      must use the raw request body.
    */

    const payload =
      await request.text();

    const signatureHeader =
      request.headers.get(
        "stripe-signature"
      );

    const validSignature =
      await verifyStripeSignature(
        payload,
        signatureHeader,
        env.STRIPE_WEBHOOK_SECRET
      );

    if (!validSignature) {
      return json(
        {
          success: false,
          error:
            "Invalid Stripe signature.",
        },
        400
      );
    }

    const event =
      JSON.parse(payload);

    /*
      We only need completed
      Checkout sessions.
    */

    if (
      event.type !==
      "checkout.session.completed"
    ) {
      return json({
        success: true,
        ignored: true,
        eventType:
          event.type,
      });
    }

    const session =
      event.data?.object;

    if (!session) {
      return json(
        {
          success: false,
          error:
            "Missing Checkout session.",
        },
        400
      );
    }

    /*
      Ignore unpaid sessions.
    */

    if (
      session.payment_status !==
      "paid"
    ) {
      return json({
        success: true,
        ignored: true,
        reason:
          "Checkout session is not paid.",
      });
    }

    const metadata =
      session.metadata || {};

    /*
      Protect the shared Supabase database.
      Only process ECB Sunrise Black
      transactions here.
    */

    if (
      metadata.team_key !==
      "ecb-sunrise-black-cooperstown"
    ) {
      return json({
        success: true,
        ignored: true,
        reason:
          "Event belongs to another team.",
      });
    }

    const playerId =
      String(
        metadata.player_id || ""
      ).trim();

    const playerKey =
      String(
        metadata.player_key || ""
      ).trim();

    const donorName =
      String(
        metadata.donor_name ||
        "Anonymous"
      ).trim() ||
      "Anonymous";

    const baseballNumbers =
      String(
        metadata.baseball_numbers ||
        ""
      )
        .split(",")
        .map(
          value =>
            Number(
              value.trim()
            )
        )
        .filter(
          value =>
            Number.isInteger(value) &&
            value >= 1 &&
            value <= 100
        );

    if (
      !playerId ||
      !playerKey ||
      !baseballNumbers.length
    ) {
      return json(
        {
          success: false,
          error:
            "Required fundraiser metadata is missing.",
        },
        400
      );
    }

    /*
      Mark each baseball sold.
      We only update baseballs that are
      still marked available.
    */

    let updatedRows = 0;

    for (
      const baseballNumber
      of baseballNumbers
    ) {
      const path =
        `baseballs` +
        `?player_id=eq.${encodeURIComponent(
          playerId
        )}` +
        `&ball_number=eq.${baseballNumber}` +
        `&status=eq.available`;

      const updated =
        await supabasePatch(
          env,
          path,
          {
            status: "sold",

            donor_name:
              donorName,

            sold_at:
              new Date()
                .toISOString(),

            stripe_session_id:
              session.id,
          }
        );

      if (
        Array.isArray(updated)
      ) {
        updatedRows +=
          updated.length;
      }
    }

    return json({
      success: true,

      paid: true,

      teamKey:
        metadata.team_key,

      playerKey,

      baseballNumbers,

      donorName,

      stripeSessionId:
        session.id,

      updatedRows,
    });

  } catch (error) {
    console.error(
      "Stripe webhook error:",
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
