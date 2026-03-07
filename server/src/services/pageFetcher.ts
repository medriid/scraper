import https from "https";
import http from "http";
import { chromium, Browser } from "playwright-core";

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
  probedEndpoints: ProbedEndpoint[];
  isCloudflareBlocked: boolean;
  alternativeUrls: string[];
}

export interface ProbedEndpoint {
  url: string;
  method: string;
  statusCode: number;
  contentType: string;
  sampleData: string;
  isJsonApi: boolean;
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

interface PlaywrightFetchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  interceptedApis: ProbedEndpoint[];
}

async function doPlaywrightFetch(targetUrl: string): Promise<PlaywrightFetchResult> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    const interceptedApis: ProbedEndpoint[] = [];

    page.on("response", async (response) => {
      const url = response.url();
      const ct = response.headers()["content-type"] ?? "";
      const status = response.status();
      if (
        ct.includes("application/json") &&
        !url.includes("analytics") &&
        !url.includes("tracking") &&
        !url.includes("telemetry") &&
        status >= 200 &&
        status < 400
      ) {
        try {
          const text = await response.text();
          interceptedApis.push({
            url,
            method: response.request().method(),
            statusCode: status,
            contentType: ct,
            sampleData: text.slice(0, 3000),
            isJsonApi: true,
          });
        } catch {}
      }
    });

    const response = await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    await page.waitForTimeout(2000);

    const body = await page.content();
    const statusCode = response?.status() ?? 0;
    const responseHeaders: Record<string, string> = {};
    if (response) {
      const allHeaders = response.headers();
      for (const [k, v] of Object.entries(allHeaders)) {
        if (typeof v === "string") responseHeaders[k] = v;
      }
    }

    await browser.close();
    browser = null;

    return {
      statusCode,
      headers: responseHeaders,
      body: body.slice(0, MAX_HTML_SIZE),
      interceptedApis,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
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

function detectCloudflareBlock(statusCode: number, headers: Record<string, string>, body: string): boolean {
  if (headers["server"]?.toLowerCase().includes("cloudflare") && (statusCode === 403 || statusCode === 503)) {
    return true;
  }
  const cfSignals = [
    "cf-browser-verification",
    "cf_chl_opt",
    "challenge-platform",
    "Just a moment...",
    "Checking your browser",
    "Attention Required! | Cloudflare",
    "_cf_chl_tk",
    "ray ID",
  ];
  const lowerBody = body.toLowerCase();
  return cfSignals.some((sig) => lowerBody.includes(sig.toLowerCase()));
}

function discoverAlternativeUrls(targetUrl: string, linkUrls: string[]): string[] {
  const parsed = new URL(targetUrl);
  const alternatives: string[] = [];
  const seen = new Set<string>([targetUrl]);

  const homepageUrl = `${parsed.protocol}//${parsed.host}/`;
  if (!seen.has(homepageUrl) && targetUrl !== homepageUrl) {
    alternatives.push(homepageUrl);
    seen.add(homepageUrl);
  }

  const commonPaths = [
    "/sitemap.xml",
    "/robots.txt",
    "/api",
    "/api/v1",
    "/graphql",
    "/wp-json/wp/v2/posts",
    "/_next/data",
  ];
  for (const path of commonPaths) {
    const url = `${parsed.protocol}//${parsed.host}${path}`;
    if (!seen.has(url)) {
      alternatives.push(url);
      seen.add(url);
    }
  }

  for (const link of linkUrls.slice(0, 10)) {
    try {
      const resolved = new URL(link, targetUrl).href;
      if (!seen.has(resolved) && resolved.startsWith(parsed.protocol)) {
        alternatives.push(resolved);
        seen.add(resolved);
      }
    } catch {}
  }

  return alternatives;
}

async function probeApiEndpoints(
  endpoints: DiscoveredEndpoint[],
  baseUrl: string
): Promise<ProbedEndpoint[]> {
  const results: ProbedEndpoint[] = [];
  const probeLimit = 8;
  const timeout = 8_000;

  const toProbe = endpoints.slice(0, probeLimit).map((ep) => {
    try {
      return { ...ep, resolvedUrl: new URL(ep.url, baseUrl).href };
    } catch {
      return null;
    }
  }).filter((ep): ep is DiscoveredEndpoint & { resolvedUrl: string } => ep !== null);

  const commonApiPaths = ["/api", "/api/v1", "/graphql"];
  const parsed = new URL(baseUrl);
  for (const path of commonApiPaths) {
    const url = `${parsed.protocol}//${parsed.host}${path}`;
    const alreadyIncluded = toProbe.some((ep) => ep.resolvedUrl === url);
    if (!alreadyIncluded && toProbe.length < probeLimit + 3) {
      toProbe.push({ url: path, method: "GET", source: "common_probe", resolvedUrl: url });
    }
  }

  const probeOne = async (ep: { resolvedUrl: string; method: string; source: string }): Promise<ProbedEndpoint | null> => {
    try {
      const fetchResult = await Promise.race([
        doFetch(ep.resolvedUrl),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
      ]);
      const ct = fetchResult.headers["content-type"] ?? "";
      const isJson = ct.includes("application/json") || ct.includes("text/json");
      const sample = fetchResult.body.slice(0, 3000);
      return {
        url: ep.resolvedUrl,
        method: ep.method,
        statusCode: fetchResult.statusCode,
        contentType: ct,
        sampleData: sample,
        isJsonApi: isJson && fetchResult.statusCode >= 200 && fetchResult.statusCode < 400,
      };
    } catch {
      return null;
    }
  };

  const probePromises = toProbe.map(probeOne);
  const settled = await Promise.allSettled(probePromises);
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      results.push(result.value);
    }
  }

  return results;
}

export async function fetchAndAnalyzePage(targetUrl: string): Promise<FetchedPage> {
  let statusCode: number;
  let headers: Record<string, string>;
  let body: string;
  let playwrightInterceptedApis: ProbedEndpoint[] = [];
  let usedPlaywright = false;

  const httpResult = await doFetch(targetUrl).catch(() => null);

  if (httpResult) {
    statusCode = httpResult.statusCode;
    headers = httpResult.headers;
    body = httpResult.body;
  } else {
    statusCode = 0;
    headers = {};
    body = "";
  }

  const cfBlocked = httpResult ? detectCloudflareBlock(statusCode, headers, body) : true;
  const tooLittleData = body.length < 500;

  if (cfBlocked || tooLittleData) {
    try {
      const pwResult = await doPlaywrightFetch(targetUrl);
      statusCode = pwResult.statusCode;
      headers = pwResult.headers;
      body = pwResult.body;
      playwrightInterceptedApis = pwResult.interceptedApis;
      usedPlaywright = true;
    } catch {
      if (!httpResult) {
        throw new Error(`Failed to fetch ${targetUrl} via both HTTP and Playwright`);
      }
    }
  }

  const isCloudflareBlocked = !usedPlaywright && cfBlocked;

  const discoveredEndpoints = extractEndpointsFromHtml(body, targetUrl);
  const scriptSources = extractScriptSources(body);
  const inlineJsonData = extractInlineJson(body);
  const metaInfo = extractMetaInfo(body);
  const formActions = extractFormActions(body);
  const linkUrls = extractLinkUrls(body, targetUrl);
  const pageTitle = metaInfo.title ?? "";

  const truncatedHtml = body.slice(0, TRUNCATED_HTML_SIZE);

  const probedEndpoints = [
    ...playwrightInterceptedApis,
    ...(await probeApiEndpoints(discoveredEndpoints, targetUrl)),
  ];
  const alternativeUrls = discoverAlternativeUrls(targetUrl, linkUrls);

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
    probedEndpoints,
    isCloudflareBlocked,
    alternativeUrls,
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

  if (page.isCloudflareBlocked) {
    lines.push(`--- ⚠️ CLOUDFLARE BLOCK DETECTED ---`);
    lines.push(`The site is protected by Cloudflare. The scraper MUST use Playwright with a real browser to bypass this.`);
    lines.push(`Plain HTTP requests (fetch/axios/requests) WILL NOT WORK. Use page.goto() with Playwright.`);
    lines.push("");
  }

  if (page.probedEndpoints.length > 0) {
    lines.push(`--- PROBED API ENDPOINTS (actual HTTP responses) ---`);
    for (const ep of page.probedEndpoints) {
      lines.push(`[${ep.method}] ${ep.url} → Status ${ep.statusCode} (${ep.contentType})`);
      if (ep.isJsonApi) {
        lines.push(`  ✅ LIVE JSON API — Sample response:`);
        lines.push(`  ${ep.sampleData.slice(0, 1500)}`);
      }
    }
    lines.push("");
  }

  if (page.alternativeUrls.length > 0) {
    lines.push(`--- Alternative URLs to try ---`);
    for (const url of page.alternativeUrls.slice(0, 15)) {
      lines.push(url);
    }
    lines.push("");
  }

  lines.push(`--- HTML Snippet (first ${page.truncatedHtml.length} chars) ---`);
  lines.push(page.truncatedHtml);

  return lines.join("\n");
}
