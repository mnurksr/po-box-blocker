import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import {
  detectPOBox,
  parseCustomPatterns,
  formatAddress,
} from "~/utils/pobox-detector";
import { holdOrder, addOrderTags } from "~/utils/shopify-api";
import { sendAddressCorrectionEmail } from "~/utils/email.server";

/**
 * Webhook handler: orders/create
 *
 * Workflow:
 * 1. Extract shipping/billing address from webhook payload
 * 2. Load shop settings
 * 3. Run P.O. Box detection engine
 * 4. If detected:
 *    a. Hold the order (if autoHold enabled)
 *    b. Add tag (if autoTag enabled)
 *    c. Log to FlaggedOrder table
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);

  console.log(`[PO-Box-Blocker] Webhook received: orders/create for shop=${shop}`);

  if (!admin) {
    // This can happen if the shop uninstalled the app
    console.log(`[PO-Box-Blocker] No admin API access for shop=${shop}, skipping.`);
    return new Response("OK", { status: 200 });
  }

  const order = payload as any;

  // Ensure the shop has settings, create defaults if not
  let settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await prisma.shopSettings.create({
      data: { shop },
    });
  }

  // If filtering is disabled for this shop, skip
  if (!settings.isEnabled) {
    console.log(`[PO-Box-Blocker] Filtering disabled for shop=${shop}, skipping.`);
    return new Response("OK", { status: 200 });
  }

  // Parse custom patterns if any
  const customPatterns = parseCustomPatterns(settings.customPatterns);

  // Run P.O. Box detection
  const result = detectPOBox(
    order.shipping_address || null,
    order.billing_address || null,
    customPatterns
  );

  if (!result.detected) {
    console.log(`[PO-Box-Blocker] Order #${order.order_number} – clean address, no P.O. Box detected.`);
    return new Response("OK", { status: 200 });
  }

  console.log(
    `[PO-Box-Blocker] ⚠️ P.O. Box DETECTED in order #${order.order_number}! Matches:`,
    result.matches
  );

  const actionsTaken: string[] = [];
  const orderId = String(order.id);

  // Auto-hold the order
  if (settings.autoHold) {
    const holdResult = await holdOrder(admin, orderId);
    if (holdResult.success) {
      actionsTaken.push("held");
      console.log(`[PO-Box-Blocker] Order #${order.order_number} placed on hold.`);
    } else {
      console.error(
        `[PO-Box-Blocker] Failed to hold order #${order.order_number}:`,
        holdResult.errors
      );
    }
  }

  // Auto-tag the order
  if (settings.autoTag) {
    const tagResult = await addOrderTags(admin, orderId, [settings.tagName]);
    if (tagResult.success) {
      actionsTaken.push("tagged");
      console.log(`[PO-Box-Blocker] Tag "${settings.tagName}" added to order #${order.order_number}.`);
    } else {
      console.error(
        `[PO-Box-Blocker] Failed to tag order #${order.order_number}:`,
        tagResult.errors
      );
    }
  }

  // Build flagged address string for logging
  const flaggedAddr =
    result.matches[0]?.field.startsWith("shipping")
      ? formatAddress(order.shipping_address || {})
      : formatAddress(order.billing_address || {});

  // Determine address type
  const addressType = result.matches[0]?.field.startsWith("shipping")
    ? "shipping"
    : "billing";

  // Send Email
  const customerEmail = order.customer?.email || order.email || null;
  const customerName = order.customer
    ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
    : null;

  if (
    settings.plan === "premium" &&
    settings.sendEmail &&
    customerEmail &&
    settings.emailSubject &&
    settings.emailBody
  ) {
    // We need to fetch the shop's email from Shopify API to set as Reply-To
    let shopEmail = "support@mercsync.com"; // Fallback
    try {
      const response = await admin.graphql(`{ shop { email } }`);
      const responseJson = await response.json();
      if (responseJson.data?.shop?.email) {
        shopEmail = responseJson.data.shop.email;
      }
    } catch (e) {
      console.warn("Could not fetch shop email for Reply-To:", e);
    }

    const emailResult = await sendAddressCorrectionEmail({
      to: customerEmail,
      replyTo: shopEmail,
      subject: settings.emailSubject,
      bodyTemplate: settings.emailBody,
      templateData: {
        customer_name: customerName || "Customer",
        order_number: String(order.order_number || order.name || ""),
        flagged_address: flaggedAddr,
      },
    });

    if (emailResult.success) {
      actionsTaken.push("emailed");
      console.log(`[PO-Box-Blocker] Email sent to ${customerEmail}`);
    } else {
      console.error(`[PO-Box-Blocker] Failed to send email to ${customerEmail}`, emailResult.error);
    }
  }

  // Log to database
  await prisma.flaggedOrder.create({
    data: {
      shop,
      orderId: orderId,
      orderNumber: String(order.order_number || order.name || ""),
      customerName: order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
        : null,
      customerEmail: order.customer?.email || order.email || null,
      flaggedAddress: flaggedAddr,
      matchedPattern: result.matches.map((m: { pattern: string }) => m.pattern).join(", "),
      addressType,
      actionsTaken: JSON.stringify(actionsTaken),
      status: "pending",
    },
  });

  console.log(
    `[PO-Box-Blocker] Order #${order.order_number} flagged and logged. Actions: ${actionsTaken.join(", ")}`
  );

  return new Response("OK", { status: 200 });
};
