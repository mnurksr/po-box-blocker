import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

/**
 * Compliance webhook: customers/redact
 * Required for public Shopify apps.
 * Removes/anonymizes stored customer data under GDPR/CCPA.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  console.log(`[PO-Box-Blocker] customers/redact received for shop=${shop}`);

  const data = payload as any;
  const customerEmail = data?.customer?.email;

  if (customerEmail) {
    // Anonymize customer data in flagged orders
    await prisma.flaggedOrder.updateMany({
      where: {
        shop,
        customerEmail,
      },
      data: {
        customerName: "[REDACTED]",
        customerEmail: "[REDACTED]",
      },
    });
    console.log(`[PO-Box-Blocker] Customer data redacted for ${customerEmail} in shop=${shop}`);
  }

  return new Response("OK", { status: 200 });
};
