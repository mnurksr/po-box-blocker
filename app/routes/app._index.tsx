import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { MONTHLY_PLAN } from "~/shopify.server";
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
  Tag,
} from "@shopify/polaris";

import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

function safeParseList(str: string | null | undefined): string[] {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Loader ──────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;

  // Sync billing status
  const billingCheck = await billing.check({
    plans: [MONTHLY_PLAN],
    isTest: true,
  });
  const hasActivePayment = billingCheck.hasActivePayment;

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.shopSettings.create({ data: { shop } });
  }

  // Update DB if out of sync
  if ((settings.plan === "premium") !== hasActivePayment) {
    settings = await prisma.shopSettings.update({
      where: { shop },
      data: { plan: hasActivePayment ? "premium" : "free" },
    });
  }

  return json({ settings, hasActivePayment });
};

// ── Action ──────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "upgrade_plan") {
    try {
      await billing.require({
        plans: [MONTHLY_PLAN],
        isTest: true,
        onFailure: async () => billing.request({ plan: MONTHLY_PLAN, isTest: true }),
      });
      return null;
    } catch (e: any) {
      console.error("UPGRADE ERROR CAUGHT:", e);
      throw e;
    }
  }

  if (intent === "cancel_plan") {
    const billingCheck = await billing.check({
      plans: [MONTHLY_PLAN],
      isTest: true,
    });
    
    if (billingCheck.hasActivePayment && billingCheck.appSubscriptions[0]) {
      const subscriptionId = billingCheck.appSubscriptions[0].id;
      await billing.cancel({
        subscriptionId,
        isTest: true,
        prorate: true,
      });
      // Sync DB
      await prisma.shopSettings.update({
        where: { shop },
        data: { plan: "free" },
      });
      return json({ success: true, message: "Subscription canceled successfully." });
    }
  }

  if (intent === "save_settings") {
    const isEnabled = formData.get("isEnabled") === "true";
    const blockMilitary = formData.get("blockMilitary") === "true";
    const blockedZips = formData.get("blockedZips") as string;
    const blockedStates = formData.get("blockedStates") as string;
    const customErrorMessage = formData.get("customErrorMessage") as string;
    const customPatterns = formData.get("customPatterns") as string;

    await prisma.shopSettings.upsert({
      where: { shop },
      update: {
        isEnabled,
        blockMilitary,
        blockedZips: blockedZips || undefined,
        blockedStates: blockedStates || undefined,
        customErrorMessage: customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.",
        customPatterns: customPatterns || undefined,
      },
      create: {
        shop,
        isEnabled,
        blockMilitary,
        blockedZips: blockedZips || undefined,
        blockedStates: blockedStates || undefined,
        customErrorMessage: customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.",
        customPatterns: customPatterns || undefined,
      },
    });

    // Write settings to AppInstallation Metafield for Checkout Validation Extension
    const billingCheck = await billing.check({ plans: [MONTHLY_PLAN], isTest: true });
    const isPremium = billingCheck.hasActivePayment;

    try {
      const appInstallRes = await admin.graphql(
        `#graphql
        query {
          currentAppInstallation {
            id
          }
        }`
      );
      const appInstallData = await appInstallRes.json();
      const appInstallationId = appInstallData.data?.currentAppInstallation?.id;

      if (appInstallationId) {
        await admin.graphql(
          `#graphql
          mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafieldsSetInput) {
              userErrors {
                message
              }
            }
          }`,
          {
            variables: {
              metafieldsSetInput: [
                {
                  ownerId: appInstallationId,
                  namespace: "poboxblocker",
                  key: "settings",
                  type: "json",
                  value: JSON.stringify({
                    isEnabled,
                    blockMilitary,
                    blockedZips,
                    blockedStates,
                    customPatterns,
                    customErrorMessage: customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.",
                    isPremium
                  }),
                },
              ],
            },
          }
        );
      }
    } catch (error) {
      console.error("Failed to update metafields:", error);
    }

    return json({ success: true, message: "Settings saved successfully!" });
  }

  return json({ success: false, message: "Unknown action." });
};

// ── Component ───────────────────────────────────────
export default function SettingsPage() {
  const { settings, hasActivePayment } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Local state (mirrors DB settings)
  const [isEnabled, setIsEnabled] = useState(settings.isEnabled);
  const [blockMilitary, setBlockMilitary] = useState(settings.blockMilitary ?? true);
  const [blockedZips, setBlockedZips] = useState<string[]>(safeParseList(settings.blockedZips));
  const [blockedStates, setBlockedStates] = useState<string[]>(safeParseList(settings.blockedStates));
  const [customErrorMessage, setCustomErrorMessage] = useState(settings.customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.");
  const [customPatterns, setCustomPatterns] = useState<string[]>(safeParseList(settings.customPatterns));

  const [zipInput, setZipInput] = useState("");
  const [stateInput, setStateInput] = useState("");
  const [patternInput, setPatternInput] = useState("");

  // Track if any changes were made
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const changed =
      isEnabled !== settings.isEnabled ||
      blockMilitary !== (settings.blockMilitary ?? true) ||
      JSON.stringify(blockedZips) !== JSON.stringify(safeParseList(settings.blockedZips)) ||
      JSON.stringify(blockedStates) !== JSON.stringify(safeParseList(settings.blockedStates)) ||
      customErrorMessage !== (settings.customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.") ||
      JSON.stringify(customPatterns) !== JSON.stringify(safeParseList(settings.customPatterns));
    setIsDirty(changed);
  }, [
    isEnabled,
    blockMilitary,
    blockedZips,
    blockedStates,
    customErrorMessage,
    customPatterns,
    settings,
  ]);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "save_settings");
    formData.set("isEnabled", String(isEnabled));
    formData.set("blockMilitary", String(blockMilitary));
    formData.set("blockedZips", JSON.stringify(blockedZips));
    formData.set("blockedStates", JSON.stringify(blockedStates));
    formData.set("customErrorMessage", customErrorMessage);
    formData.set("customPatterns", JSON.stringify(customPatterns));
    submit(formData, { method: "POST" });
  }, [
    isEnabled,
    blockMilitary,
    blockedZips,
    blockedStates,
    customErrorMessage,
    customPatterns,
    submit,
  ]);

  const isPremium = hasActivePayment;

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



          {/* Advanced Blocking – Premium */}
          <Layout.AnnotatedSection
            title={
              <InlineStack gap="200" blockAlign="center">
                <span>Advanced Blocking</span>
                {!isPremium && <Badge tone="attention">Premium</Badge>}
              </InlineStack>
            }
            description="Block addresses at checkout before payment is completed, and set up advanced region rules."
          >
            <Card>
              <BlockStack gap="400">
                {!isPremium ? (
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      Advanced blocking features are available on the Premium plan.
                      Upgrade to block P.O. Boxes directly at the checkout screen, and to restrict delivery to specific regions.
                    </Text>
                  </Banner>
                ) : (
                  <>
                    <TextField
                      label="Checkout Error Message"
                      value={customErrorMessage}
                      onChange={setCustomErrorMessage}
                      autoComplete="off"
                      helpText="The error message shown to customers at checkout when their address is blocked."
                    />

                    <Divider />

                    <Checkbox
                      label="Block Military Addresses (APO/FPO/DPO)"
                      helpText="Also block military addresses in addition to standard P.O. Boxes."
                      checked={blockMilitary}
                      onChange={setBlockMilitary}
                    />

                    <BlockStack gap="200">
                      <TextField
                        label="Blocked Zip Codes"
                        value={zipInput}
                        onChange={setZipInput}
                        autoComplete="off"
                        placeholder="e.g. 009"
                        helpText="Enter a zip code prefix to block (e.g. 009 for Puerto Rico)."
                        connectedRight={
                          <Button
                            onClick={() => {
                              if (zipInput.trim() && !blockedZips.includes(zipInput.trim())) {
                                setBlockedZips([...blockedZips, zipInput.trim()]);
                                setZipInput("");
                              }
                            }}
                          >
                            Add
                          </Button>
                        }
                      />
                      {blockedZips.length > 0 && (
                        <InlineStack gap="200">
                          {blockedZips.map((zip) => (
                            <Tag key={zip} onRemove={() => setBlockedZips(blockedZips.filter((z) => z !== zip))}>
                              {zip}
                            </Tag>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>

                    <BlockStack gap="200">
                      <TextField
                        label="Blocked States"
                        value={stateInput}
                        onChange={setStateInput}
                        autoComplete="off"
                        placeholder="e.g. HI"
                        helpText="Enter a state code to block (e.g. HI for Hawaii)."
                        connectedRight={
                          <Button
                            onClick={() => {
                              if (stateInput.trim() && !blockedStates.includes(stateInput.trim().toUpperCase())) {
                                setBlockedStates([...blockedStates, stateInput.trim().toUpperCase()]);
                                setStateInput("");
                              }
                            }}
                          >
                            Add
                          </Button>
                        }
                      />
                      {blockedStates.length > 0 && (
                        <InlineStack gap="200">
                          {blockedStates.map((st) => (
                            <Tag key={st} onRemove={() => setBlockedStates(blockedStates.filter((s) => s !== st))}>
                              {st}
                            </Tag>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>
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
                  <BlockStack gap="200">
                    <TextField
                      label="Custom Regex Patterns"
                      value={patternInput}
                      onChange={setPatternInput}
                      autoComplete="off"
                      placeholder="e.g. \\bcommunity\\s+box\\b"
                      helpText="Enter a regex pattern string. These will be checked in addition to the 14 built-in patterns."
                      connectedRight={
                        <Button
                          onClick={() => {
                            if (patternInput.trim() && !customPatterns.includes(patternInput.trim())) {
                              setCustomPatterns([...customPatterns, patternInput.trim()]);
                              setPatternInput("");
                            }
                          }}
                        >
                          Add
                        </Button>
                      }
                    />
                    {customPatterns.length > 0 && (
                      <InlineStack gap="200">
                        {customPatterns.map((pattern) => (
                          <Tag key={pattern} onRemove={() => setCustomPatterns(customPatterns.filter((p) => p !== pattern))}>
                            {pattern}
                          </Tag>
                        ))}
                      </InlineStack>
                    )}
                  </BlockStack>
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
                      Real-time validation at checkout
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Block Military Addresses (APO/FPO/DPO)
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Block by State / Zip Code
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
                <Box paddingBlockStart="400">
                  {isPremium ? (
                    <Button
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("intent", "cancel_plan");
                        submit(formData, { method: "POST" });
                      }}
                      tone="critical"
                      variant="plain"
                    >
                      Downgrade to Free
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("intent", "upgrade_plan");
                        submit(formData, { method: "POST" });
                      }}
                      variant="primary"
                    >
                      Upgrade to Premium ($5/mo)
                    </Button>
                  )}
                </Box>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
