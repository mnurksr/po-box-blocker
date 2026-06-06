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

  // No customer data is stored by this app anymore, so nothing to redact.

  return new Response("OK", { status: 200 });
};
