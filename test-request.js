async function run() {
  const { billing } = require("@shopify/shopify-app-remix/server");
  console.log("type of billing.request is", typeof billing);
}
run();
