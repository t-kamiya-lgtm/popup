/** Public origin of this admin app, used to build the OAuth callback/redirect_uri (docs/09-cart-integration.md 3.5). */
export function appBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (!value) throw new Error("NEXT_PUBLIC_APP_BASE_URL is not set");
  return value.replace(/\/$/, "");
}
