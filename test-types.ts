import { BillingInterval, BillingReplacementBehavior } from "@shopify/shopify-app-remix/server";
const x: any = {
  interval: BillingInterval.Every30Days,
  lineItems: [{ amount: 5, currencyCode: "USD" }]
};
