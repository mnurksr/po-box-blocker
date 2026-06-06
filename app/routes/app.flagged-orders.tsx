import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
  useSearchParams,
} from "@remix-run/react";
import { useState, useCallback } from "react";
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
  Button,
  ButtonGroup,
  Banner,
  Filters,
  ChoiceList,
  Divider,
  Modal,
  Box,
} from "@shopify/polaris";

import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { removeOrderTags, releaseOrderHold } from "~/utils/shopify-api";

const PAGE_SIZE = 20;

// ── Loader ──────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "all";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const skip = (page - 1) * PAGE_SIZE;

  const where: any = { shop };
  if (statusFilter !== "all") {
    where.status = statusFilter;
  }

  const [orders, totalCount] = await Promise.all([
    prisma.flaggedOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip,
    }),
    prisma.flaggedOrder.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Get counts per status for filters
  const [pendingCount, resolvedCount, ignoredCount] = await Promise.all([
    prisma.flaggedOrder.count({ where: { shop, status: "pending" } }),
    prisma.flaggedOrder.count({ where: { shop, status: "resolved" } }),
    prisma.flaggedOrder.count({ where: { shop, status: "ignored" } }),
  ]);

  // Get shop settings for tag name
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  return json({
    orders,
    totalCount,
    page,
    totalPages,
    statusFilter,
    counts: {
      pending: pendingCount,
      resolved: resolvedCount,
      ignored: ignoredCount,
      all: pendingCount + resolvedCount + ignoredCount,
    },
    tagName: settings?.tagName || "PO_BOX_ERROR",
  });
};

// ── Action ──────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "update_status") {
    const orderId = formData.get("flaggedOrderId") as string;
    const newStatus = formData.get("newStatus") as string;

    const flaggedOrder = await prisma.flaggedOrder.findUnique({
      where: { id: orderId },
    });

    if (!flaggedOrder || flaggedOrder.shop !== shop) {
      return json({ success: false, message: "Order not found." });
    }

    // If resolving, optionally release hold and remove tag
    if (newStatus === "resolved" && flaggedOrder.status === "pending") {
      const settings = await prisma.shopSettings.findUnique({
        where: { shop },
      });

      // Release hold
      const actions = JSON.parse(flaggedOrder.actionsTaken || "[]");
      if (actions.includes("held")) {
        await releaseOrderHold(admin, flaggedOrder.orderId);
      }

      // Remove tag
      if (actions.includes("tagged") && settings) {
        await removeOrderTags(admin, flaggedOrder.orderId, [settings.tagName]);
      }
    }

    await prisma.flaggedOrder.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        resolvedAt: newStatus === "resolved" ? new Date() : undefined,
      },
    });

    return json({
      success: true,
      message: `Order marked as ${newStatus}.`,
    });
  }

  if (intent === "bulk_update") {
    const ids = (formData.get("ids") as string).split(",");
    const newStatus = formData.get("newStatus") as string;

    await prisma.flaggedOrder.updateMany({
      where: { id: { in: ids }, shop },
      data: {
        status: newStatus,
        resolvedAt: newStatus === "resolved" ? new Date() : undefined,
      },
    });

    return json({
      success: true,
      message: `${ids.length} orders marked as ${newStatus}.`,
    });
  }

  return json({ success: false, message: "Unknown action." });
};

// ── Component ───────────────────────────────────────
export default function FlaggedOrdersPage() {
  const {
    orders,
    totalCount,
    page,
    totalPages,
    statusFilter,
    counts,
    tagName,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state !== "idle";

  // Selected rows for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Status filter
  const handleFilterChange = useCallback(
    (value: string[]) => {
      const newStatus = value[0] || "all";
      setSearchParams({ status: newStatus, page: "1" });
    },
    [setSearchParams]
  );

  const handleFilterClear = useCallback(() => {
    setSearchParams({ status: "all", page: "1" });
  }, [setSearchParams]);

  // Single order status update
  const handleStatusUpdate = useCallback(
    (flaggedOrderId: string, newStatus: string) => {
      const formData = new FormData();
      formData.set("intent", "update_status");
      formData.set("flaggedOrderId", flaggedOrderId);
      formData.set("newStatus", newStatus);
      submit(formData, { method: "POST" });
    },
    [submit]
  );

  // Pagination
  const handlePagination = useCallback(
    (newPage: number) => {
      setSearchParams({
        status: statusFilter,
        page: String(newPage),
      });
    },
    [statusFilter, setSearchParams]
  );

  // Format date
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
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

  // Actions taken badges
  const actionBadges = (actionsJson: string | null) => {
    if (!actionsJson) return "—";
    try {
      const actions: string[] = JSON.parse(actionsJson);
      return (
        <InlineStack gap="100">
          {actions.map((a, i) => (
            <Badge key={i} tone={a === "held" ? "warning" : "info"}>
              {a}
            </Badge>
          ))}
        </InlineStack>
      );
    } catch {
      return "—";
    }
  };

  // Build rows
  const rows = orders.map((order: any) => [
    `#${order.orderNumber}`,
    order.customerName || "—",
    order.flaggedAddress.length > 35
      ? order.flaggedAddress.substring(0, 35) + "…"
      : order.flaggedAddress,
    order.matchedPattern,
    actionBadges(order.actionsTaken),
    statusBadge(order.status),
    formatDate(order.createdAt),
    order.status === "pending" ? (
      <ButtonGroup>
        <Button
          size="slim"
          onClick={() => handleStatusUpdate(order.id, "resolved")}
        >
          Resolve
        </Button>
        <Button
          size="slim"
          tone="critical"
          variant="plain"
          onClick={() => handleStatusUpdate(order.id, "ignored")}
        >
          Ignore
        </Button>
      </ButtonGroup>
    ) : order.status === "ignored" ? (
      <Button
        size="slim"
        variant="plain"
        onClick={() => handleStatusUpdate(order.id, "resolved")}
      >
        Resolve
      </Button>
    ) : (
      <Text as="span" tone="subdued" variant="bodySm">
        Done
      </Text>
    ),
  ]);

  // Filter options
  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: `All (${counts.all})`, value: "all" },
            { label: `Pending (${counts.pending})`, value: "pending" },
            { label: `Resolved (${counts.resolved})`, value: "resolved" },
            { label: `Ignored (${counts.ignored})`, value: "ignored" },
          ]}
          selected={[statusFilter]}
          onChange={handleFilterChange}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters =
    statusFilter !== "all"
      ? [
          {
            key: "status",
            label: `Status: ${statusFilter}`,
            onRemove: handleFilterClear,
          },
        ]
      : [];

  return (
    <Page
      title="Flagged Orders"
      subtitle={`${totalCount} total flagged orders`}
    >
      <BlockStack gap="500">
        {/* Action feedback */}
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        <Card padding="0">
          <Box padding="400">
            <Filters
              queryValue=""
              queryPlaceholder="Search by order number..."
              filters={filters}
              appliedFilters={appliedFilters}
              onQueryChange={() => {}}
              onQueryClear={() => {}}
              onClearAll={handleFilterClear}
            />
          </Box>

          {orders.length === 0 ? (
            <Box padding="400">
              <EmptyState
                heading={
                  statusFilter === "all"
                    ? "No flagged orders yet"
                    : `No ${statusFilter} orders`
                }
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" variant="bodyMd">
                  {statusFilter === "all"
                    ? "When orders with P.O. Box addresses come in, they'll appear here."
                    : `There are no orders with "${statusFilter}" status.`}
                </Text>
              </EmptyState>
            </Box>
          ) : (
            <DataTable
              columnContentTypes={[
                "text",
                "text",
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
                "Actions Taken",
                "Status",
                "Date",
                "",
              ]}
              rows={rows}
              footerContent={`Page ${page} of ${totalPages} • ${totalCount} total orders`}
            />
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <Box padding="400">
              <InlineStack align="center" gap="200">
                <Button
                  disabled={page <= 1}
                  onClick={() => handlePagination(page - 1)}
                >
                  ← Previous
                </Button>
                <Text as="span" variant="bodySm">
                  Page {page} of {totalPages}
                </Text>
                <Button
                  disabled={page >= totalPages}
                  onClick={() => handlePagination(page + 1)}
                >
                  Next →
                </Button>
              </InlineStack>
            </Box>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
