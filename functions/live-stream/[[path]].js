const STREAM_HOST = "customer-biq66v3wnxdbml6l.cloudflarestream.com";
const ROUTE_PREFIX = "/live-stream/";

function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders()
  });
}

export async function onRequest(context) {
  const { request } = context;
  const incomingUrl = new URL(request.url);

  if (!incomingUrl.pathname.startsWith(ROUTE_PREFIX)) {
    return new Response("Not found", { status: 404 });
  }

  const upstreamPath = incomingUrl.pathname.slice(ROUTE_PREFIX.length);
  if (!upstreamPath) {
    return new Response("Missing stream path", { status: 400 });
  }

  const targetUrl = new URL(`https://${STREAM_HOST}/${upstreamPath}`);
  targetUrl.search = incomingUrl.search;

  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.delete("host");
  upstreamHeaders.delete("cf-connecting-ip");
  upstreamHeaders.delete("cf-ipcountry");
  upstreamHeaders.delete("cf-ray");
  upstreamHeaders.delete("x-forwarded-proto");
  upstreamHeaders.delete("x-real-ip");

  const upstreamResponse = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: upstreamHeaders,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "follow"
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  const corsHeaders = buildCorsHeaders();
  for (const [key, value] of Object.entries(corsHeaders)) {
    responseHeaders.set(key, value);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
}
