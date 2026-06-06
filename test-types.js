"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var server_1 = require("@shopify/shopify-app-remix/server");
var x = {
    interval: server_1.BillingInterval.Every30Days,
    lineItems: [{ amount: 5, currencyCode: "USD" }]
};
