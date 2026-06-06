/**
 * Shopify Admin GraphQL API Helpers
 *
 * Provides typed mutations for:
 * - Putting orders on hold
 * - Adding tags to orders
 * - Adding notes to orders
 * - Releasing held orders
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface GraphQLUserError {
  field?: string[];
  message: string;
}

interface OrderHoldResult {
  success: boolean;
  errors: string[];
}

interface TagsResult {
  success: boolean;
  errors: string[];
}

// ──────────────────────────────────────────────
// Put Order On Hold
// ──────────────────────────────────────────────

const ORDER_HOLD_MUTATION = `#graphql
  mutation orderHold($id: ID!, $reason: String!, $reasonNote: String) {
    orderEditBegin(id: $id) {
      calculatedOrder {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Shopify 2025-01: Use fulfillmentOrders/hold approach
const FULFILLMENT_HOLD_MUTATION = `#graphql
  mutation fulfillmentOrderHold($fulfillmentOrderId: ID!, $reason: FulfillmentHoldReason!, $reasonNotes: String) {
    fulfillmentOrderHold(
      id: $fulfillmentOrderId
      fulfillmentHold: {
        reason: $reason
        reasonNotes: $reasonNotes
      }
    ) {
      fulfillmentOrder {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_FULFILLMENT_ORDERS_QUERY = `#graphql
  query getFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
        }
      }
    }
  }
`;

/**
 * Put an order on hold by holding all its fulfillment orders.
 * Uses the fulfillmentOrderHold mutation (Shopify 2024-10+).
 */
export async function holdOrder(
  admin: AdminApiContext,
  orderId: string,
  reasonNote: string = "P.O. Box address detected – awaiting physical address from customer."
): Promise<OrderHoldResult> {
  const errors: string[] = [];

  try {
    // Step 1: Get fulfillment orders for this order
    const fulfillmentResponse = await admin.graphql(
      GET_FULFILLMENT_ORDERS_QUERY,
      { variables: { orderId: `gid://shopify/Order/${orderId}` } }
    );
    const fulfillmentData = await fulfillmentResponse.json();
    const fulfillmentOrders =
      fulfillmentData?.data?.order?.fulfillmentOrders?.nodes || [];

    if (fulfillmentOrders.length === 0) {
      return { success: false, errors: ["No fulfillment orders found"] };
    }

    // Step 2: Hold each open fulfillment order
    for (const fo of fulfillmentOrders) {
      if (fo.status === "OPEN" || fo.status === "IN_PROGRESS") {
        const holdResponse = await admin.graphql(FULFILLMENT_HOLD_MUTATION, {
          variables: {
            fulfillmentOrderId: fo.id,
            reason: "OTHER",
            reasonNotes: reasonNote,
          },
        });
        const holdData = await holdResponse.json();
        const userErrors =
          holdData?.data?.fulfillmentOrderHold?.userErrors || [];
        if (userErrors.length > 0) {
          errors.push(
            ...userErrors.map((e: GraphQLUserError) => e.message)
          );
        }
      }
    }

    return { success: errors.length === 0, errors };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

// ──────────────────────────────────────────────
// Add Tags to Order
// ──────────────────────────────────────────────

const TAGS_ADD_MUTATION = `#graphql
  mutation addTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Add one or more tags to a Shopify order.
 */
export async function addOrderTags(
  admin: AdminApiContext,
  orderId: string,
  tags: string[]
): Promise<TagsResult> {
  try {
    const response = await admin.graphql(TAGS_ADD_MUTATION, {
      variables: {
        id: `gid://shopify/Order/${orderId}`,
        tags,
      },
    });
    const data = await response.json();
    const userErrors = data?.data?.tagsAdd?.userErrors || [];

    return {
      success: userErrors.length === 0,
      errors: userErrors.map((e: GraphQLUserError) => e.message),
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

// ──────────────────────────────────────────────
// Remove Tags from Order
// ──────────────────────────────────────────────

const TAGS_REMOVE_MUTATION = `#graphql
  mutation removeTags($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Remove tags from a Shopify order (used when resolving flagged orders).
 */
export async function removeOrderTags(
  admin: AdminApiContext,
  orderId: string,
  tags: string[]
): Promise<TagsResult> {
  try {
    const response = await admin.graphql(TAGS_REMOVE_MUTATION, {
      variables: {
        id: `gid://shopify/Order/${orderId}`,
        tags,
      },
    });
    const data = await response.json();
    const userErrors = data?.data?.tagsRemove?.userErrors || [];

    return {
      success: userErrors.length === 0,
      errors: userErrors.map((e: GraphQLUserError) => e.message),
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

// ──────────────────────────────────────────────
// Release Held Order
// ──────────────────────────────────────────────

const FULFILLMENT_RELEASE_MUTATION = `#graphql
  mutation fulfillmentOrderRelease($id: ID!) {
    fulfillmentOrderReleaseHold(id: $id) {
      fulfillmentOrder {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Release hold on all fulfillment orders for an order.
 * Used when a flagged order is resolved.
 */
export async function releaseOrderHold(
  admin: AdminApiContext,
  orderId: string
): Promise<OrderHoldResult> {
  const errors: string[] = [];

  try {
    const fulfillmentResponse = await admin.graphql(
      GET_FULFILLMENT_ORDERS_QUERY,
      { variables: { orderId: `gid://shopify/Order/${orderId}` } }
    );
    const fulfillmentData = await fulfillmentResponse.json();
    const fulfillmentOrders =
      fulfillmentData?.data?.order?.fulfillmentOrders?.nodes || [];

    for (const fo of fulfillmentOrders) {
      if (fo.status === "ON_HOLD") {
        const releaseResponse = await admin.graphql(
          FULFILLMENT_RELEASE_MUTATION,
          { variables: { id: fo.id } }
        );
        const releaseData = await releaseResponse.json();
        const userErrors =
          releaseData?.data?.fulfillmentOrderReleaseHold?.userErrors || [];
        if (userErrors.length > 0) {
          errors.push(
            ...userErrors.map((e: GraphQLUserError) => e.message)
          );
        }
      }
    }

    return { success: errors.length === 0, errors };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}
