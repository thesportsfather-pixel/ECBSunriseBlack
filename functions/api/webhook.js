import { json, verifyStripeSignature, finalizePaidSession } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      return json({ success:false, error:"Missing server configuration: STRIPE_WEBHOOK_SECRET" }, 500);
    }

    const payload = await request.text();
    const signature = request.headers.get("stripe-signature");
    const valid = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) return json({ success:false, error:"Invalid Stripe signature." }, 400);

    const event = JSON.parse(payload);

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await finalizePaidSession(env, event.data.object);
    }

    return json({ received:true });
  } catch (error) {
    console.error(error);
    return json({ success:false, error:error.message || "Webhook error" }, 500);
  }
}
