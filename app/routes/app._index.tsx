import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { STANDARD_PLAN, PREMIUM_PLAN } from "~/shopify.server";
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
  InlineGrid,
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
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Sync billing status
  const billingCheck = await billing.check({
    plans: [STANDARD_PLAN, PREMIUM_PLAN],
    isTest: false,
  });
  
  const hasPremium = billingCheck.appSubscriptions?.some(sub => sub.name === PREMIUM_PLAN) || false;
  const hasStandard = billingCheck.appSubscriptions?.some(sub => sub.name === STANDARD_PLAN) || false;
  
  let activePlan = "none";
  if (hasPremium) activePlan = "premium";
  else if (hasStandard) activePlan = "standart";

  let settings = {
    isEnabled: true,
    plan: "none",
    blockedZips: "",
    blockedStates: "",
    blockMilitary: true,
    customErrorMessage: "We do not ship to P.O. Boxes. Please enter a physical address.",
    regionErrorMessage: "We do not ship to this region.",
    hasDismissedOnboarding: false,
  };

  try {
    let dbSettings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!dbSettings) {
      dbSettings = await prisma.shopSettings.create({ data: { shop } });
    }

    // Update DB if out of sync
    if (dbSettings.plan !== activePlan) {
      dbSettings = await prisma.shopSettings.update({
        where: { shop },
        data: { plan: activePlan },
      });
    }
    settings = dbSettings;
  } catch (e) {
    console.error("Prisma Error:", e);
    // Fallback to defaults if DB fails
    settings.plan = activePlan;
  }

  // Fetch the function ID to create a deep link
  let functionId = null;
  try {
    const funcRes = await admin.graphql(
      `#graphql
      query {
        app {
          installation {
            id
          }
        }
        shopifyFunctions(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }`
    );
    const funcData = await funcRes.json();
    const idString = funcData.data?.shopifyFunctions?.edges?.[0]?.node?.id;
    if (idString) {
      // Extract the UUID part from gid://shopify/AppFunction/UUID
      functionId = idString.split("/").pop();
    }
  } catch (e) {
    console.error("Failed to fetch function ID:", e);
  }

  // Auto-sync settings to Metafield if they just upgraded or loaded the app
  try {
    const shopRes = await admin.graphql(
      `#graphql
      query { shop { id } }`
    );
    const shopData = await shopRes.json();
    const shopId = shopData.data?.shop?.id;
    if (shopId) {
      await admin.graphql(
        `#graphql
        mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafieldsSetInput) {
            userErrors { message }
          }
        }`,
        {
          variables: {
            metafieldsSetInput: [
              {
                ownerId: shopId,
                namespace: "$app:poboxblocker",
                key: "settings",
                type: "json",
                value: JSON.stringify({
                  isEnabled: settings.isEnabled,
                  blockedZips: settings.blockedZips,
                  blockedStates: settings.blockedStates,
                  blockMilitary: settings.blockMilitary,
                  customErrorMessage: settings.customErrorMessage,
                  regionErrorMessage: settings.regionErrorMessage,
                  isPremium: hasPremium,
                }),
              },
            ],
          },
        }
      );
    }
  } catch (e) {
    console.error("Failed to auto-sync metafields:", e);
  }

  return json({ settings, activePlan, functionId });
};

// ── Action ──────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "dismiss_onboarding") {
    await prisma.shopSettings.update({
      where: { shop },
      data: { hasDismissedOnboarding: true },
    });
    return json({ success: true });
  }

  if (intent === "upgrade_to_premium") {
    try {
      await billing.require({
        plans: [PREMIUM_PLAN],
        isTest: false,
        onFailure: async () => billing.request({ plan: PREMIUM_PLAN, isTest: false }),
      });
      return null;
    } catch (e: any) {
      console.error("UPGRADE ERROR CAUGHT:", e);
      throw e;
    }
  }

  if (intent === "upgrade_to_standart") {
    try {
      await billing.require({
        plans: [STANDARD_PLAN],
        isTest: false,
        onFailure: async () => billing.request({ plan: STANDARD_PLAN, isTest: false }),
      });
      return null;
    } catch (e: any) {
      console.error("UPGRADE ERROR CAUGHT:", e);
      throw e;
    }
  }

  if (intent === "save_settings") {
    const isEnabled = formData.get("isEnabled") === "true";
    const blockMilitary = formData.get("blockMilitary") === "true";
    const blockedZips = formData.get("blockedZips") as string;
    const blockedStates = formData.get("blockedStates") as string;
    const customErrorMessage = formData.get("customErrorMessage") as string;
    const regionErrorMessage = formData.get("regionErrorMessage") as string;

    await prisma.shopSettings.upsert({
      where: { shop },
      update: {
        isEnabled,
        blockMilitary,
        blockedZips: blockedZips || undefined,
        blockedStates: blockedStates || undefined,
        customErrorMessage: customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.",
        regionErrorMessage: regionErrorMessage || "We do not ship to this region.",
      },
      create: {
        shop,
        isEnabled,
        blockMilitary,
        blockedZips: blockedZips || undefined,
        blockedStates: blockedStates || undefined,
        customErrorMessage: customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.",
        regionErrorMessage: regionErrorMessage || "We do not ship to this region.",
      },
    });

    // Write settings to AppInstallation Metafield for Checkout Validation Extension
    const billingCheck = await billing.check({ plans: [STANDARD_PLAN, PREMIUM_PLAN], isTest: false });
    const isPremium = billingCheck.appSubscriptions?.some(sub => sub.name === PREMIUM_PLAN) || false;

    try {
      const shopRes = await admin.graphql(
        `#graphql
        query {
          shop {
            id
          }
        }`
      );
      const shopData = await shopRes.json();
      const shopId = shopData.data?.shop?.id;

      if (shopId) {
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
                  ownerId: shopId,
                  namespace: "$app:poboxblocker",
                  key: "settings",
                  type: "json",
                  value: JSON.stringify({
                    isEnabled,
                    blockMilitary,
                    blockedZips,
                    blockedStates,
                    customErrorMessage: customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.",
                    regionErrorMessage: regionErrorMessage || "We do not ship to this region.",
                    isPremium
                  }),
                },
              ],
            },
          }
        );
        const resJson = await res.json();
        if (resJson.data?.metafieldsSet?.userErrors?.length) {
          console.error("Metafield user errors:", resJson.data.metafieldsSet.userErrors);
        } else {
          console.log("Metafield successfully updated!");
        }
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
  const { settings, activePlan, functionId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Derive deep link url
  const deepLinkUrl = functionId 
    ? `shopify:admin/settings/checkout/rules/validation/add/${functionId}`
    : "shopify:admin/settings/checkout";

  // Local state (mirrors DB settings)
  const [isEnabled, setIsEnabled] = useState(settings.isEnabled);
  const [blockMilitary, setBlockMilitary] = useState(settings.blockMilitary ?? true);
  const [blockedZips, setBlockedZips] = useState<string[]>(safeParseList(settings.blockedZips));
  const [blockedStates, setBlockedStates] = useState<string[]>(safeParseList(settings.blockedStates));
  const [customErrorMessage, setCustomErrorMessage] = useState(settings.customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.");
  const [regionErrorMessage, setRegionErrorMessage] = useState(settings.regionErrorMessage || "We do not ship to this region.");
  const [showOnboarding, setShowOnboarding] = useState(!settings.hasDismissedOnboarding);

  const [zipInput, setZipInput] = useState("");
  const [stateInput, setStateInput] = useState("");

  // Track if any changes were made
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const changed =
      isEnabled !== settings.isEnabled ||
      blockMilitary !== (settings.blockMilitary ?? true) ||
      JSON.stringify(blockedZips) !== JSON.stringify(safeParseList(settings.blockedZips)) ||
      JSON.stringify(blockedStates) !== JSON.stringify(safeParseList(settings.blockedStates)) ||
      customErrorMessage !== (settings.customErrorMessage || "We do not ship to P.O. Boxes. Please enter a physical address.") ||
      regionErrorMessage !== (settings.regionErrorMessage || "We do not ship to this region.");
    setIsDirty(changed);
  }, [
    isEnabled,
    blockMilitary,
    blockedZips,
    blockedStates,
    customErrorMessage,
    regionErrorMessage,
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
    formData.set("regionErrorMessage", regionErrorMessage);
    submit(formData, { method: "POST" });
  }, [
    isEnabled,
    blockMilitary,
    blockedZips,
    blockedStates,
    customErrorMessage,
    regionErrorMessage,
    submit,
  ]);

  const handleDismissOnboarding = () => {
    setShowOnboarding(false);
    const formData = new FormData();
    formData.set("intent", "dismiss_onboarding");
    submit(formData, { method: "POST" });
  };

  const isPremium = activePlan === "premium";
  const isStandard = activePlan === "standart";
  const hasPlan = isPremium || isStandard;

  if (!hasPlan) {
    return (
      <Page>
        <Box paddingBlockStart="1000" paddingBlockEnd="1000">
          <BlockStack gap="800" align="center" inlineAlign="center">
            <BlockStack gap="200" inlineAlign="center">
              <Text as="h1" variant="heading2xl" alignment="center">
                Upgrade to protect your checkouts
              </Text>
              <Text as="p" variant="bodyLg" tone="subdued" alignment="center">
                Select a plan to block invalid addresses and stop shipping delays.
              </Text>
            </BlockStack>

            <Box minWidth="800px">
              <InlineGrid columns={2} gap="400">
                <Card>
                  <BlockStack gap="500">
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingLg">Standard</Text>
                      <Text as="p" tone="subdued">Essential protection for small stores.</Text>
                    </BlockStack>
                    <Box>
                      <Text as="p" variant="heading3xl">$4.99 <Text as="span" variant="bodyMd" tone="subdued">/ month</Text></Text>
                    </Box>
                    <Button 
                      size="large"
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("intent", "upgrade_to_standart");
                        submit(formData, { method: "POST" });
                      }} 
                      variant="secondary" 
                      loading={isSubmitting}
                    >
                      Start 14-Day Trial
                    </Button>
                    <Divider />
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Block P.O. Boxes natively at checkout</Text></InlineStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Advanced 14+ detection patterns</Text></InlineStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Email Support</Text></InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Card>

                <Card background="bg-surface-secondary">
                  <BlockStack gap="500">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="200">
                        <Text as="h2" variant="headingLg">Premium</Text>
                        <Text as="p" tone="subdued">Advanced control & region blocking.</Text>
                      </BlockStack>
                      <Badge tone="success">Recommended</Badge>
                    </InlineStack>
                    <Box>
                      <Text as="p" variant="heading3xl">$9.99 <Text as="span" variant="bodyMd" tone="subdued">/ month</Text></Text>
                    </Box>
                    <Button 
                      size="large"
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("intent", "upgrade_to_premium");
                        submit(formData, { method: "POST" });
                      }} 
                      variant="primary" 
                      loading={isSubmitting}
                    >
                      Start 14-Day Trial
                    </Button>
                    <Divider />
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">All Standard features included</Text></InlineStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Block Military Addresses (APO/FPO)</Text></InlineStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Block specific States & Regions</Text></InlineStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Block custom Zip Codes</Text></InlineStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Customizable error messages</Text></InlineStack>
                      <InlineStack gap="200" blockAlign="center" wrap={false}><Text as="span">✅</Text><Text as="span">Priority Email Support</Text></InlineStack>
                    </BlockStack>
                  </BlockStack>
                </Card>
              </InlineGrid>
            </Box>
          </BlockStack>
        </Box>
      </Page>
    );
  }

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
        {showOnboarding && (
          <Banner
            title="Action Required: Activate in Checkout Settings"
            tone="warning"
            action={{
              content: "1. Go to Checkout Settings",
              url: deepLinkUrl,
              target: "_blank",
            }}
            secondaryAction={{
              content: "2. I've Activated It (Hide this)",
              onAction: handleDismissOnboarding,
            }}
          >
            <Text as="p">
              Shopify requires you to manually activate checkout extensions. To make PO Box Blocker work, click the button above to open the rule creation page. Give it a title (like <strong>PO Box Blocker</strong>), set the status to <strong>Active</strong>, and click <strong>Save</strong>.
            </Text>
          </Banner>
        )}

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
                      Upgrade to block Military Addresses and specific states or zip codes.
                    </Text>
                  </Banner>
                ) : (
                  <>
                    <TextField
                      label="Checkout Error Message (P.O. Box & Military)"
                      value={customErrorMessage}
                      onChange={setCustomErrorMessage}
                      autoComplete="off"
                      helpText="The error message shown to customers at checkout when their address is blocked because of a P.O. Box or Military Address."
                    />

                    <Divider />

                    <TextField
                      label="Checkout Error Message (State & Zip Code)"
                      value={regionErrorMessage}
                      onChange={setRegionErrorMessage}
                      autoComplete="off"
                      helpText="The error message shown when the address is blocked due to State or Zip Code rules."
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

          {/* Plan Info */}
          <Layout.AnnotatedSection
            title="Your Plan"
            description="Current plan information and available features."
          >
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    {isPremium ? "Premium Plan" : "Standard Plan"}
                  </Text>
                  <Badge tone={isPremium ? "success" : "info"}>
                    {isPremium ? "PREMIUM ($9.99/mo)" : "STANDARD ($4.99/mo)"}
                  </Badge>
                </InlineStack>
                <Divider />
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">✅</Text>
                    <Text as="span" variant="bodySm">
                      Block P.O. Boxes natively at checkout
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">✅</Text>
                    <Text as="span" variant="bodySm">
                      Advanced 14+ detection patterns
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">✅</Text>
                    <Text as="span" variant="bodySm">
                      Email Support
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Block Military Addresses (APO/FPO)
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Block specific States & Regions
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Block custom Zip Codes
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Customizable error messages
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{isPremium ? "✅" : "🔒"}</Text>
                    <Text
                      as="span"
                      variant="bodySm"
                      tone={isPremium ? undefined : "subdued"}
                    >
                      Priority Email Support
                    </Text>
                  </InlineStack>
                </BlockStack>
                <Box paddingBlockStart="400">
                  {!isPremium && (
                    <Button
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("intent", "upgrade_to_premium");
                        submit(formData, { method: "POST" });
                      }}
                      variant="primary"
                    >
                      Upgrade to Premium ($9.99/mo)
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
