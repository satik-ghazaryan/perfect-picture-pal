export const PAYMENT_SECRET_HEADER = "x-payment-secret";

export function serverPaymentSecret() {
  if (typeof process === "undefined" || !process.env) return "";
  return process.env["PAYMENT_SECRET"]?.trim() || "";
}

function sameText(left: string, right: string) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index % (right.length || 1));
  }
  return difference === 0;
}

/**
 * True only when the server has PAYMENT_SECRET set and the request repeats it in the
 * x-payment-secret header. Anything that costs money or reaches a real phone must pass this.
 */
export function requestCarriesPaymentSecret(request: Request) {
  const secret = serverPaymentSecret();
  if (!secret) return false;
  return sameText(request.headers.get(PAYMENT_SECRET_HEADER) ?? "", secret);
}
