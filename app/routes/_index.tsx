import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return Response.json({ showForm: Boolean(login) });
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.4", padding: "2rem" }}>
      <h1>PO Box Blocker</h1>
      <p>This is a Shopify app. It must be installed from the Shopify Admin.</p>
      {showForm && (
        <Form method="post" action="/auth/login">
          <label>
            <span>Shop domain</span>
            <input type="text" name="shop" />
            <span>e.g: my-shop-domain.myshopify.com</span>
          </label>
          <button type="submit">Log in</button>
        </Form>
      )}
    </div>
  );
}
