import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  DataTable,
  EmptyState,
  Box,
  InlineGrid,
  Divider,
  Button,
  Banner,
  Icon,
} from "@shopify/polaris";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ShieldCheckMarkIcon,
  OrderIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Ensure settings exist
  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.shopSettings.create({ data: { shop } });
  }

  // Get stats
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [totalFlagged, todayFlagged, pendingCount, resolvedCount, recentOrders] =
    await Promise.all([
      prisma.flaggedOrder.count({ where: { shop } }),
      prisma.flaggedOrder.count({
        where: { shop, createdAt: { gte: todayStart } },
      }),
      prisma.flaggedOrder.count({ where: { shop, status: "pending" } }),
      prisma.flaggedOrder.count({ where: { shop, status: "resolved" } }),
      prisma.flaggedOrder.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

  return json({
    settings,
    stats: {
      totalFlagged,
      todayFlagged,
      pendingCount,
      resolvedCount,
    },
    recentOrders,
  });
};

export default function Dashboard() {
  const { settings, stats, recentOrders } = useLoaderData<typeof loader>();

  // Format date for display
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Status badge
  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge tone="warning">Pending</Badge>;
      case "resolved":
        return <Badge tone="success">Resolved</Badge>;
      case "ignored":
        return <Badge tone="info">Ignored</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // Build DataTable rows
  const rows = recentOrders.map((order: any) => [
    `#${order.orderNumber}`,
    order.customerName || "—",
    order.flaggedAddress.length > 40
      ? order.flaggedAddress.substring(0, 40) + "…"
      : order.flaggedAddress,
    order.matchedPattern,
    statusBadge(order.status),
    formatDate(order.createdAt),
  ]);

  return (
    <Page title="P.O. Box Blocker">
      <BlockStack gap="500">
        {/* Status Banner */}
        {settings.isEnabled ? (
          <Banner tone="success">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" fontWeight="semibold">
                Protection Active
              </Text>
              <Text as="span">
                — Your store is protected against P.O. Box addresses.
              </Text>
            </InlineStack>
          </Banner>
        ) : (
          <Banner tone="warning">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" fontWeight="semibold">
                Protection Disabled
              </Text>
              <Text as="span">
                — P.O. Box filtering is currently turned off.{" "}
              </Text>
              <Button url="/app/settings" variant="plain">
                Enable in Settings
              </Button>
            </InlineStack>
          </Banner>
        )}

        {/* Stats Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Today's Blocks
                </Text>
                <Icon source={ShieldCheckMarkIcon} tone="base" />
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {stats.todayFlagged}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Total Blocked
                </Text>
                <Icon source={OrderIcon} tone="base" />
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {stats.totalFlagged}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Pending Review
                </Text>
                <Icon source={AlertTriangleIcon} tone="warning" />
              </InlineStack>
              <Text
                as="p"
                variant="headingXl"
                fontWeight="bold"
                tone={stats.pendingCount > 0 ? "caution" : "success"}
              >
                {stats.pendingCount}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Resolved
                </Text>
                <Icon source={CheckCircleIcon} tone="success" />
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {stats.resolvedCount}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Active Settings Summary */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Active Protection Rules
            </Text>
            <Divider />
            <InlineStack gap="400" wrap>
              <InlineStack gap="100" blockAlign="center">
                <Badge tone={settings.autoHold ? "success" : "enabled"}>
                  {settings.autoHold ? "ON" : "OFF"}
                </Badge>
                <Text as="span" variant="bodySm">
                  Auto Hold Orders
                </Text>
              </InlineStack>

              <InlineStack gap="100" blockAlign="center">
                <Badge tone={settings.autoTag ? "success" : "enabled"}>
                  {settings.autoTag ? "ON" : "OFF"}
                </Badge>
                <Text as="span" variant="bodySm">
                  Auto Tag: <strong>{settings.tagName}</strong>
                </Text>
              </InlineStack>

              <InlineStack gap="100" blockAlign="center">
                <Badge tone={settings.sendEmail ? "attention" : "enabled"}>
                  {settings.sendEmail ? "ON" : "OFF"}
                </Badge>
                <Text as="span" variant="bodySm">
                  Email Notification{" "}
                  {settings.plan === "free" && (
                    <Badge tone="info">Premium</Badge>
                  )}
                </Text>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Recent Flagged Orders */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Recent Flagged Orders
              </Text>
              {recentOrders.length > 0 && (
                <Button url="/app/flagged-orders" variant="plain">
                  View All →
                </Button>
              )}
            </InlineStack>
            <Divider />

            {recentOrders.length === 0 ? (
              <EmptyState
                heading="No flagged orders yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" variant="bodyMd">
                  When a customer places an order with a P.O. Box address, it
                  will appear here. Your store is being monitored!
                </Text>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Order",
                  "Customer",
                  "Flagged Address",
                  "Pattern",
                  "Status",
                  "Date",
                ]}
                rows={rows}
                footerContent={`Showing ${recentOrders.length} of ${stats.totalFlagged} total flagged orders`}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
