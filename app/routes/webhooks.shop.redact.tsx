import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

/**
 * Compliance webhook: shop/redact
 * Required for public Shopify apps.
 * Removes all shop data after uninstallation (48h grace period).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  console.log(`[PO-Box-Blocker] shop/redact received for shop=${shop}`);

  // Delete all shop data
  await prisma.flaggedOrder.deleteMany({ where: { shop } });
  await prisma.shopSettings.deleteMany({ where: { shop } });

  console.log(`[PO-Box-Blocker] All data deleted for shop=${shop}`);

  return new Response("OK", { status: 200 });
};
