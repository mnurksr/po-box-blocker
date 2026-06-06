import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Button,
  Banner,
  Badge,
  Divider,
  Box,
  Tooltip,
} from "@shopify/polaris";

import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

// ── Loader ──────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.shopSettings.create({ data: { shop } });
  }

  return json({ settings });
};

// ── Action ──────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save_settings") {
    const isEnabled = formData.get("isEnabled") === "true";
    const autoHold = formData.get("autoHold") === "true";
    const autoTag = formData.get("autoTag") === "true";
    const tagName = (formData.get("tagName") as string) || "PO_BOX_ERROR";
    const sendEmail = formData.get("sendEmail") === "true";
    const emailSubject = formData.get("emailSubject") as string;
    const emailBody = formData.get("emailBody") as string;
    const customPatterns = formData.get("customPatterns") as string;

    await prisma.shopSettings.upsert({
      where: { shop },
      update: {
        isEnabled,
        autoHold,
        autoTag,
        tagName,
        sendEmail,
        emailSubject: emailSubject || undefined,
        emailBody: emailBody || undefined,
        customPatterns: customPatterns || undefined,
      },
      create: {
        shop,
        isEnabled,
        autoHold,
        autoTag,
        tagName,
        sendEmail,
        emailSubject: emailSubject || undefined,
        emailBody: emailBody || undefined,
        customPatterns: customPatterns || undefined,
      },
    });

    return json({ success: true, message: "Settings saved successfully!" });
  }

  return json({ success: false, message: "Unknown action." });
};

// ── Component ───────────────────────────────────────
export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Local state (mirrors DB settings)
  const [isEnabled, setIsEnabled] = useState(settings.isEnabled);
  const [autoHold, setAutoHold] = useState(settings.autoHold);
  const [autoTag, setAutoTag] = useState(settings.autoTag);
  const [tagName, setTagName] = useState(settings.tagName);
  const [sendEmail, setSendEmail] = useState(settings.sendEmail);
  const [emailSubject, setEmailSubject] = useState(settings.emailSubject || "");
  const [emailBody, setEmailBody] = useState(settings.emailBody || "");
  const [customPatterns, setCustomPatterns] = useState(
    settings.customPatterns || ""
  );

  // Track if any changes were made
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const changed =
      isEnabled !== settings.isEnabled ||
      autoHold !== settings.autoHold ||
      autoTag !== settings.autoTag ||
      tagName !== settings.tagName ||
      sendEmail !== settings.sendEmail ||
      emailSubject !== (settings.emailSubject || "") ||
      emailBody !== (settings.emailBody || "") ||
      customPatterns !== (settings.customPatterns || "");
    setIsDirty(changed);
  }, [
    isEnabled,
    autoHold,
    autoTag,
    tagName,
    sendEmail,
    emailSubject,
    emailBody,
    customPatterns,
    settings,
  ]);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "save_settings");
    formData.set("isEnabled", String(isEnabled));
    formData.set("autoHold", String(autoHold));
    formData.set("autoTag", String(autoTag));
    formData.set("tagName", tagName);
    formData.set("sendEmail", String(sendEmail));
    formData.set("emailSubject", emailSubject);
    formData.set("emailBody", emailBody);
    formData.set("customPatterns", customPatterns);
    submit(formData, { method: "POST" });
  }, [
    isEnabled,
    autoHold,
    autoTag,
    tagName,
    sendEmail,
    emailSubject,
    emailBody,
    customPatterns,
    submit,
  ]);

  const isPremium = settings.plan === "premium";

  return (
    <Page
      title="Settings"
      primaryAction={{
        content: "Save",
        onAction: handleSave,
        loading: isSubmitting,
        disabled: !isDirty || isSubmitting,
      }}
    >
      <BlockStack gap="500">
        {/* Success/Error Banner */}
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        <Layout>
          {/* Main Protection Toggle */}
          <Layout.AnnotatedSection
            title="Protection Status"
            description="Enable or disable P.O. Box address filtering for your store."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Enable P.O. Box filtering"
                  helpText="When enabled, all incoming orders will be scanned for P.O. Box addresses."
                  checked={isEnabled}
                  onChange={setIsEnabled}
                />
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Current status:
                  </Text>
                  <Badge tone={isEnabled ? "success" : "critical"}>
                    {isEnabled ? "ACTIVE" : "DISABLED"}
                  </Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* Auto Actions */}
          <Layout.AnnotatedSection
            title="Automatic Actions"
            description="Configure what happens when a P.O. Box address is detected."
          >
            <Card>
              <BlockStack gap="400">
                <Checkbox
                  label="Automatically hold orders"
                  helpText="When a P.O. Box is detected, the order's fulfillment will be placed on hold until the address is corrected."
                  checked={autoHold}
                  onChange={setAutoHold}
                />

                <Divider />

                <Checkbox
                  label="Automatically add tag"
                  helpText="Add a tag to flagged orders so you can easily filter them in Shopify admin."
                  checked={autoTag}
                  onChange={setAutoTag}
                />
                {autoTag && (
                  <Box paddingInlineStart="800">
                    <TextField
                      label="Tag name"
                      value={tagName}
                      onChange={setTagName}
                      autoComplete="off"
                      placeholder="PO_BOX_ERROR"
                      helpText="This tag will be added to orders with P.O. Box addresses."
                    />
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* Email Notifications – Premium */}
          <Layout.AnnotatedSection
            title={
              <InlineStack gap="200" blockAlign="center">
                <span>Email Notifications</span>
                {!isPremium && <Badge tone="attention">Premium</Badge>}
              </InlineStack>
            }
            description="Automatically notify customers when their order is flagged due to a P.O. Box address."
          >
            <Card>
              <BlockStack gap="400">
                {!isPremium ? (
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      Email notifications are available on the Premium plan.
                      Upgrade to automatically send address correction requests
                      to your customers.
                    </Text>
                  </Banner>
                ) : (
                  <>
                    <Checkbox
                      label="Send email to customer"
                      helpText="An email will be sent requesting the customer to provide a physical shipping address."
                      checked={sendEmail}
                      onChange={setSendEmail}
                    />
                    {sendEmail && (
                      <BlockStack gap="300">
                        <TextField
                          label="Email subject"
                          value={emailSubject}
                          onChange={setEmailSubject}
                          autoComplete="off"
                          placeholder="Action Required: Please Update Your Shipping Address"
                        />
                        <TextField
                          label="Email body"
                          value={emailBody}
                          onChange={setEmailBody}
                          autoComplete="off"
                          multiline={6}
                          placeholder={
                            "Dear {{customer_name}},\n\nWe noticed your order #{{order_number}} contains a P.O. Box address. Unfortunately, our shipping carriers cannot deliver to P.O. Box addresses.\n\nPlease reply to this email with a physical street address so we can ship your order.\n\nThank you!"
                          }
                          helpText="Available variables: {{customer_name}}, {{order_number}}, {{flagged_address}}"
                        />
                      </BlockStack>
                    )}
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* Custom Patterns – Premium */}
          <Layout.AnnotatedSection
            title={
              <InlineStack gap="200" blockAlign="center">
                <span>Custom Patterns</span>
                {!isPremium && <Badge tone="attention">Premium</Badge>}
              </InlineStack>
            }
            description="Add custom regex patterns to catch additional address formats specific to your business."
          >
            <Card>
              <BlockStack gap="400">
                {!isPremium ? (
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      Custom patterns are available on the Premium plan. The
                      built-in engine already covers 14+ P.O. Box variations
                      including military, rural, and evasion patterns.
                    </Text>
                  </Banner>
                ) : (
                  <TextField
                    label="Custom regex patterns (JSON array)"
                    value={customPatterns}
                    onChange={setCustomPatterns}
                    autoComplete="off"
                    multiline={4}
                    placeholder='["\\\\bgeneral\\\\s+delivery\\\\b", "\\\\bcommunity\\\\s+box\\\\b"]'
                    helpText="Enter a JSON array of regex pattern strings. These will be checked in addition to the 14 built-in patterns."
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          {/* Plan Info */}
          <Layout.AnnotatedSection
            title="Your Plan"
            description="Current plan information and available features."
          >
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    {isPremium ? "Premium Plan" : "Free Plan"}
                  </Text>
                  <Badge tone={isPremium ? "success" : "info"}>
                    {isPremium ? "PREMIUM" : "FREE"}
                  </Badge>
                </InlineStack>
                <Divider />
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">✅</Text>
                    <Text as="span" variant="bodySm">
                      P.O. Box detection (14+ patterns)
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">✅</Text>
                    <Text as="span" variant="bodySm">
                      Auto-hold orders
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">✅</Text>
                    <Text as="span" variant="bodySm">
                      Auto-tag orders
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">✅</Text>
                    <Text as="span" variant="bodySm">
                      Dashboard & flagged orders list
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Email notifications to customers
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Custom regex patterns
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
