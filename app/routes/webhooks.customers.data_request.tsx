import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

/**
 * Compliance webhook: customers/data_request
 * Required for public Shopify apps.
 * Handles customer data export requests under GDPR/CCPA.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  console.log(`[PO-Box-Blocker] customers/data_request received for shop=${shop}`);

  // This app stores minimal customer data (name, email) in FlaggedOrder.
  // In production, you would compile and return/email the data.
  // For now, we acknowledge the request.

  return new Response("OK", { status: 200 });
};
