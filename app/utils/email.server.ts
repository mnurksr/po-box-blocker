import { Resend } from "resend";

// Resend API Key will be read from environment variables.
// You need to set RESEND_API_KEY in the .env / Coolify.
const resend = new Resend(process.env.RESEND_API_KEY || "re_dummy_key");

interface SendEmailParams {
  to: string;
  replyTo: string; // The merchant's email address
  subject: string;
  bodyTemplate: string; // The raw template from settings with {{customer_name}} etc.
  templateData: {
    customer_name: string;
    order_number: string;
    flagged_address: string;
  };
}

export async function sendAddressCorrectionEmail({
  to,
  replyTo,
  subject,
  bodyTemplate,
  templateData,
}: SendEmailParams) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not set. Email will not be sent.");
    return { success: false, error: "Missing API Key" };
  }

  // Replace template variables
  let body = bodyTemplate || "";
  body = body.replace(/\{\{customer_name\}\}/g, templateData.customer_name);
  body = body.replace(/\{\{order_number\}\}/g, templateData.order_number);
  body = body.replace(/\{\{flagged_address\}\}/g, templateData.flagged_address);

  try {
    const data = await resend.emails.send({
      from: "PO Box Blocker <noreply@poboxblocker.mercsync.com>",
      to,
      reply_to: replyTo,
      subject,
      text: body,
      // You can also add HTML version if you want, but plain text feels more personal
    });

    console.log("Email sent via Resend:", data);
    return { success: true, data };
  } catch (error) {
    console.error("Failed to send email via Resend:", error);
    return { success: false, error };
  }
}
