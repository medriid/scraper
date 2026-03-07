import https from "https";
import http from "http";

export interface FetchedPage {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  html: string;
  discoveredEndpoints: DiscoveredEndpoint[];
  inlineJsonData: string[];
  scriptSources: string[];
  metaInfo: Record<string, string>;
  formActions: string[];
  linkUrls: string[];
  pageTitle: string;
  truncatedHtml: string;
}

export interface DiscoveredEndpoint {
  url: string;
  method: string;
  source: string;
}

const MAX_HTML_SIZE = 512_000;
const TRUNCATED_HTML_SIZE = 30_000;
const MAX_REDIRECTS = 5;

function doFetch(
  targetUrl: string,
  redirectCount = 0
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  if (redirectCount > MAX_REDIRECTS) {
    return Promise.reject(new Error("Too many redirects"));
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    const req = transport.get(
      targetUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 15_000,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const redirectUrl = new URL(res.headers.location, targetUrl).href;
          doFetch(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
          res.resume();
          return;
        }

        const chunks: Buffer[] = [];
        let totalSize = 0;
        res.on("data", (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize <= MAX_HTML_SIZE) {
            chunks.push(chunk);
          }
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(", ");
          }
          resolve({ statusCode: res.statusCode ?? 0, headers, body });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

function extractEndpointsFromHtml(html: string, baseUrl: string): DiscoveredEndpoint[] {
  const endpoints: DiscoveredEndpoint[] = [];
  const seen = new Set<string>();

  const addEndpoint = (url: string, method: string, source: string) => {
    const key = `${method}:${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    endpoints.push({ url, method, source });
  };

  const apiPatterns = [
    /["'`](\/api\/[^"'`\s]+)["'`]/g,
    /["'`](\/graphql[^"'`\s]*)["'`]/g,
    /["'`](\/v[0-9]+\/[^"'`\s]+)["'`]/g,
    /["'`](\/wp-json\/[^"'`\s]+)["'`]/g,
    /["'`](\/_next\/data\/[^"'`\s]+)["'`]/g,
    /["'`](\/rest\/[^"'`\s]+)["'`]/g,
    /["'`](\/ajax\/[^"'`\s]+)["'`]/g,
    /["'`](\/rpc\/[^"'`\s]+)["'`]/g,
    /["'`](\/search[?/][^"'`\s]+)["'`]/g,
  ];

  for (const pattern of apiPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      addEndpoint(match[1], "GET", "html_pattern");
    }
  }

  const fetchPatterns = [
    /fetch\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{[^}]*method\s*:\s*["'`](\w+)["'`])?/g,
    /\.(?:get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    /axios\s*(?:\.\w+)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /XMLHttpRequest[\s\S]*?\.open\s*\(\s*["'`](\w+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g,
    /\$\.(?:ajax|get|post|getJSON)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const pattern of fetchPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (pattern.source.includes("XMLHttpRequest")) {
        addEndpoint(match[2], match[1].toUpperCase(), "xhr_pattern");
      } else if (pattern.source.includes("get|post|put|patch|delete")) {
        const methodMatch = match[0].match(/\.(get|post|put|patch|delete)\s*\(/i);
        addEndpoint(match[1], methodMatch ? methodMatch[1].toUpperCase() : "GET", "http_client");
      } else {
        addEndpoint(match[1], match[2]?.toUpperCase() ?? "GET", "fetch_call");
      }
    }
  }

  const fullUrlPatterns = [
    /["'`](https?:\/\/[^"'`\s]*\/api\/[^"'`\s]+)["'`]/g,
    /["'`](https?:\/\/[^"'`\s]*\/graphql[^"'`\s]*)["'`]/g,
    /["'`](https?:\/\/[^"'`\s]*\/v[0-9]+\/[^"'`\s]+)["'`]/g,
    /["'`](https?:\/\/[^"'`\s]*\/rest\/[^"'`\s]+)["'`]/g,
  ];

  for (const pattern of fullUrlPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      addEndpoint(match[1], "GET", "full_url");
    }
  }

  const authPatterns = [
    /["'`](\/(?:auth|login|signin|signup|register|oauth|token|session)[^"'`\s]*)["'`]/gi,
    /["'`](https?:\/\/[^"'`\s]*\/(?:auth|login|signin|oauth|token)[^"'`\s]*)["'`]/gi,
  ];

  for (const pattern of authPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      addEndpoint(match[1], "POST", "auth_endpoint");
    }
  }

  return endpoints;
}

function extractScriptSources(html: string): string[] {
  const sources: string[] = [];
  const scriptPattern = /<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    sources.push(match[1]);
  }
  return sources;
}

function extractInlineJson(html: string): string[] {
  const jsonBlocks: string[] = [];
  const MAX_BLOCK_SIZE = 10_000;

  const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([^<]{1,100000})<\/script>/i);
  if (nextDataMatch) {
    jsonBlocks.push(nextDataMatch[1].trim().slice(0, 5000));
  }

  const ldJsonPattern = /<script\s+type="application\/ld\+json"[^>]*>([^<]{1,50000})<\/script>/gi;
  let match;
  while ((match = ldJsonPattern.exec(html)) !== null) {
    jsonBlocks.push(match[1].trim().slice(0, 3000));
  }

  const statePatterns = [
    /window\.__INITIAL_STATE__\s*=\s*(\{[^;]{1,100000});/i,
    /window\.__PRELOADED_STATE__\s*=\s*(\{[^;]{1,100000});/i,
    /window\.__APP_STATE__\s*=\s*(\{[^;]{1,100000});/i,
    /window\.__DATA__\s*=\s*(\{[^;]{1,100000});/i,
    /window\.__NUXT__\s*=\s*(\{[^;]{1,100000});/i,
  ];

  for (const pattern of statePatterns) {
    const stateMatch = html.match(pattern);
    if (stateMatch) {
      jsonBlocks.push(stateMatch[1].trim().slice(0, MAX_BLOCK_SIZE));
    }
  }

  return jsonBlocks;
}

function extractMetaInfo(html: string): Record<string, string> {
  const meta: Record<string, string> = {};

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) meta.title = titleMatch[1].trim();

  const metaPattern = /<meta\s+(?:name|property|http-equiv)=["']([^"']+)["']\s+content=["']([^"']+)["']/gi;
  let match;
  while ((match = metaPattern.exec(html)) !== null) {
    meta[match[1]] = match[2];
  }

  const metaPattern2 = /<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']([^"']+)["']/gi;
  while ((match = metaPattern2.exec(html)) !== null) {
    meta[match[2]] = match[1];
  }

  return meta;
}

function extractFormActions(html: string): string[] {
  const actions: string[] = [];
  const formPattern = /<form[^>]*\baction=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = formPattern.exec(html)) !== null) {
    actions.push(match[1]);
  }
  return actions;
}

function extractLinkUrls(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a[^>]*\bhref=["']([^"'#]+)["'][^>]*>/gi;
  let match;
  let count = 0;
  while ((match = linkPattern.exec(html)) !== null && count < 100) {
    const href = match[1];
    if (!seen.has(href) && !href.startsWith("javascript:") && !href.startsWith("mailto:") && !href.startsWith("data:") && !href.startsWith("vbscript:")) {
      seen.add(href);
      links.push(href);
      count++;
    }
  }
  return links;
}

export async function fetchAndAnalyzePage(targetUrl: string): Promise<FetchedPage> {
  const { statusCode, headers, body } = await doFetch(targetUrl);

  const discoveredEndpoints = extractEndpointsFromHtml(body, targetUrl);
  const scriptSources = extractScriptSources(body);
  const inlineJsonData = extractInlineJson(body);
  const metaInfo = extractMetaInfo(body);
  const formActions = extractFormActions(body);
  const linkUrls = extractLinkUrls(body, targetUrl);
  const pageTitle = metaInfo.title ?? "";

  const truncatedHtml = body.slice(0, TRUNCATED_HTML_SIZE);

  return {
    url: targetUrl,
    statusCode,
    headers,
    html: body,
    discoveredEndpoints,
    inlineJsonData,
    scriptSources,
    metaInfo,
    formActions,
    linkUrls,
    pageTitle,
    truncatedHtml,
  };
}

export function buildPageReport(page: FetchedPage): string {
  const lines: string[] = [];
  lines.push(`=== PAGE FETCH REPORT ===`);
  lines.push(`URL: ${page.url}`);
  lines.push(`Status: ${page.statusCode}`);
  lines.push(`Title: ${page.pageTitle}`);
  lines.push("");

  lines.push(`--- Response Headers (relevant) ---`);
  const relevantHeaders = ["content-type", "server", "x-powered-by", "set-cookie", "x-request-id"];
  for (const h of relevantHeaders) {
    if (page.headers[h]) {
      lines.push(`${h}: ${page.headers[h].slice(0, 200)}`);
    }
  }
  lines.push("");

  lines.push(`--- Meta Information ---`);
  for (const [k, v] of Object.entries(page.metaInfo).slice(0, 20)) {
    lines.push(`${k}: ${v.slice(0, 200)}`);
  }
  lines.push("");

  if (page.discoveredEndpoints.length > 0) {
    lines.push(`--- Discovered API Endpoints (${page.discoveredEndpoints.length}) ---`);
    for (const ep of page.discoveredEndpoints.slice(0, 50)) {
      lines.push(`[${ep.method}] ${ep.url} (source: ${ep.source})`);
    }
    lines.push("");
  } else {
    lines.push(`--- No API Endpoints Discovered in HTML ---`);
    lines.push("");
  }

  if (page.inlineJsonData.length > 0) {
    lines.push(`--- Inline JSON / State Data (${page.inlineJsonData.length} blocks) ---`);
    for (let i = 0; i < page.inlineJsonData.length; i++) {
      lines.push(`[Block ${i + 1}]: ${page.inlineJsonData[i].slice(0, 2000)}`);
    }
    lines.push("");
  }

  if (page.scriptSources.length > 0) {
    lines.push(`--- Script Sources (${page.scriptSources.length}) ---`);
    for (const src of page.scriptSources.slice(0, 30)) {
      lines.push(src);
    }
    lines.push("");
  }

  if (page.formActions.length > 0) {
    lines.push(`--- Form Actions ---`);
    for (const action of page.formActions) {
      lines.push(action);
    }
    lines.push("");
  }

  if (page.linkUrls.length > 0) {
    lines.push(`--- Sample Links (${page.linkUrls.length}) ---`);
    for (const link of page.linkUrls.slice(0, 40)) {
      lines.push(link);
    }
    lines.push("");
  }

  lines.push(`--- HTML Snippet (first ${page.truncatedHtml.length} chars) ---`);
  lines.push(page.truncatedHtml);

  return lines.join("\n");
}
