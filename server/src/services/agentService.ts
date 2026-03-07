import { Response } from "express";
import { chatCompletion, streamCompletion } from "./aiService.js";
import { generateApiFileTemplate, generatePyFileTemplate, generateDataApiTemplate, generateDataApiPyTemplate } from "../templates/apiTemplate.js";
import { updateSession } from "./supabaseService.js";
import { fetchAndAnalyzePage, buildPageReport, FetchedPage } from "./pageFetcher.js";

export interface AgentStep {
  type:
    | "thinking"
    | "browsing"
    | "fetching"
    | "analyzing"
    | "discovering"
    | "crawling"
    | "generating"
    | "refining"
    | "testing"
    | "validating"
    | "building"
    | "complete"
    | "error";
  message: string;
  detail?: string;
  data?: unknown;
}

export interface AuthCredentials {
  email?: string;
  password?: string;
  token?: string;
  cookies?: string;
}

function sendSSE(res: Response, event: string, data: unknown): void {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

export async function runAgentSession(
  sessionId: string | null,
  websiteUrl: string,
  instructions: string,
  modelId: string,
  language: string,
  extractionMode: string,
  credentials: AuthCredentials | undefined,
  res: Response
): Promise<void> {
  const steps: AgentStep[] = [];
  const isTs = language !== "python";
  const langLabel = isTs ? "TypeScript" : "Python";
  const ext = isTs ? "ts" : "py";
  const isDataApi = extractionMode === "data_api";

  const emit = (step: AgentStep) => {
    steps.push(step);
    sendSSE(res, "step", step);
  };

  try {
    // ── Step 1: Actually fetch the page (with retry + alternative URLs) ───────
    emit({
      type: "fetching",
      message: "Fetching target website",
      detail: `Making real HTTP request to ${websiteUrl}…`,
    });

    let pageReport: string;
    let endpointCount = 0;
    let fetchedHtmlSnippet = "";
    let discoveredEndpointsText = "";
    let inlineDataText = "";
    let probedApiText = "";
    let isCloudflareBlocked = false;
    let liveApiEndpoints: { url: string; sampleData: string }[] = [];

    const tryFetchPage = async (url: string): Promise<FetchedPage | null> => {
      try {
        return await fetchAndAnalyzePage(url);
      } catch {
        return null;
      }
    };

    let page = await tryFetchPage(websiteUrl);

    if (page && page.isCloudflareBlocked) {
      isCloudflareBlocked = true;
      emit({
        type: "browsing",
        message: "Cloudflare protection detected",
        detail: "Site is behind Cloudflare — generated scraper will use Playwright browser to bypass this. Trying alternative URLs…",
      });

      for (const altUrl of page.alternativeUrls.slice(0, 4)) {
        const altPage = await tryFetchPage(altUrl);
        if (altPage && !altPage.isCloudflareBlocked && altPage.html.length > 1000) {
          emit({
            type: "browsing",
            message: `Found accessible page: ${altUrl}`,
            detail: `Status ${altPage.statusCode} · Merging discovered data…`,
          });
          page.discoveredEndpoints.push(...altPage.discoveredEndpoints);
          page.probedEndpoints.push(...altPage.probedEndpoints);
          page.inlineJsonData.push(...altPage.inlineJsonData);
          page.linkUrls.push(...altPage.linkUrls);
          if (altPage.html.length > page.html.length) {
            page.html = altPage.html;
            page.truncatedHtml = altPage.truncatedHtml;
          }
          break;
        }
      }
    }

    if (page && (page.html.length < 500 || page.discoveredEndpoints.length === 0) && !page.isCloudflareBlocked) {
      emit({
        type: "browsing",
        message: "Minimal data found — probing alternative URLs",
        detail: "Checking homepage and common API paths for more data…",
      });

      for (const altUrl of (page.alternativeUrls ?? []).slice(0, 5)) {
        const altPage = await tryFetchPage(altUrl);
        if (altPage && altPage.html.length > page.html.length) {
          page.discoveredEndpoints.push(...altPage.discoveredEndpoints);
          page.probedEndpoints.push(...altPage.probedEndpoints);
          page.inlineJsonData.push(...altPage.inlineJsonData);
          if (altPage.html.length > page.html.length) {
            page.html = altPage.html;
            page.truncatedHtml = altPage.truncatedHtml;
          }
        }
      }
    }

    if (page) {
      pageReport = buildPageReport(page);
      endpointCount = page.discoveredEndpoints.length;
      fetchedHtmlSnippet = page.truncatedHtml;
      discoveredEndpointsText = page.discoveredEndpoints
        .map((ep) => `[${ep.method}] ${ep.url} (source: ${ep.source})`)
        .join("\n");
      inlineDataText = page.inlineJsonData.map((d, i) => `[Block ${i + 1}]: ${d.slice(0, 2000)}`).join("\n");

      liveApiEndpoints = page.probedEndpoints
        .filter((ep) => ep.isJsonApi)
        .map((ep) => ({ url: ep.url, sampleData: ep.sampleData }));

      probedApiText = page.probedEndpoints
        .map((ep) => {
          let line = `[${ep.method}] ${ep.url} → Status ${ep.statusCode} (${ep.contentType})`;
          if (ep.isJsonApi) {
            line += `\n  ✅ LIVE JSON API — Sample: ${ep.sampleData.slice(0, 1000)}`;
          }
          return line;
        })
        .join("\n");

      const liveApiCount = liveApiEndpoints.length;
      emit({
        type: "browsing",
        message: "Page fetched successfully",
        detail: `Status ${page.statusCode} · ${endpointCount} endpoint(s) in HTML · ${liveApiCount} live JSON API(s) confirmed · ${page.inlineJsonData.length} inline data blocks${isCloudflareBlocked ? " · ⚠️ Cloudflare detected" : ""}`,
        data: { endpointCount },
      });
    } else {
      const fetchMsg = "All fetch attempts failed";
      pageReport = `FETCH FAILED: ${fetchMsg}\nURL: ${websiteUrl}\nThe page could not be fetched directly. The scraper MUST use Playwright (headless browser) to load this page — plain HTTP requests will not work.`;
      fetchedHtmlSnippet = "";
      isCloudflareBlocked = true;

      emit({
        type: "browsing",
        message: "Direct fetch failed — site requires browser rendering",
        detail: "Generated scraper will use Playwright to navigate the site with a real browser.",
      });
    }

    await sleep(300);

    // ── Step 2: Deep analysis with REAL page data ────────────────────────────
    emit({
      type: "thinking",
      message: "AI analyzing real page data",
      detail: "Examining fetched HTML, discovered endpoints, inline JSON, and scripts…",
    });

    const analysisPrompt = `You are an expert web scraping and crawling engineer. You MUST base your analysis ENTIRELY on the REAL page data provided below. Do NOT guess or assume anything about the website — only describe what you can see in the actual fetched data.

CRITICAL: You are a PERSISTENT crawling engineer. Your PRIMARY job is to figure out how to CRAWL this website thoroughly — navigating from page to page, following links, discovering content. Crawling means: loading the starting page, finding all navigable links (listing pages, detail pages, category pages, pagination), and visiting each one to extract data. NEVER give up. Always recommend crawling the homepage, following links, checking sitemaps, and intercepting network requests.

Website URL: ${websiteUrl}
User Instructions: ${instructions}
${isDataApi ? `\nExtraction Mode: DATA API (authenticated user data extraction)\nUser provided credentials: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", token/API key" : ""}${credentials?.cookies ? ", cookies" : ""}` : "Extraction Mode: SCRAPER (public data extraction)"}
${isCloudflareBlocked ? "\n⚠️ CLOUDFLARE PROTECTION DETECTED: The site blocks plain HTTP requests. The scraper MUST use Playwright (headless browser) for ALL requests. Do NOT suggest using fetch/axios/requests directly — they will be blocked." : ""}

=== ACTUAL FETCHED PAGE DATA ===
${pageReport}
=== END PAGE DATA ===

${probedApiText ? `=== PROBED API ENDPOINTS (actual HTTP responses received) ===\n${probedApiText}\n=== END PROBED ENDPOINTS ===\n\nIMPORTANT: The above are REAL responses from actual API endpoint probes. Any endpoint marked ✅ LIVE JSON API is a confirmed working API that returns structured JSON data.` : ""}

${liveApiEndpoints.length > 0 ? `\n🎯 LIVE APIs: ${liveApiEndpoints.length} LIVE JSON API(s) were confirmed. These can supplement crawling.` : ""}

Based ONLY on the actual data above, provide your analysis:

1. SITE TYPE: What kind of site is this based on the HTML, meta tags, and content you can see?

2. CRAWLING STRUCTURE (MOST IMPORTANT):
   - What is the site's navigation structure? (homepage → categories → listings → detail pages)
   - What links on the current page lead to content pages?
   - What CSS selectors identify navigable links to content?
   - Is there pagination? What selectors/patterns indicate next pages?
   - Are there category/section links that lead to more content?
   - What is the URL pattern for detail pages?

3. API ENDPOINTS FOUND: List every API endpoint you can see in the fetched data.

4. INLINE DATA: Describe any __NEXT_DATA__, ld+json, window.__STATE__, or other inline JSON/data.

5. HTML STRUCTURE: Describe the actual DOM structure — repeating elements, CSS classes/IDs, data attributes for extraction.

6. AUTHENTICATION: ${isDataApi ? "Describe how authentication works. What auth endpoints exist?" : "Are there any auth walls? Does the page show public data?"}

7. RECOMMENDED CRAWLING STRATEGY (PRIORITY ORDER):
   a. CRAWL with Playwright — load pages in a real browser, follow links to detail pages, extract data from each page
   b. INTERCEPT network requests during crawling — use page.on('response') to catch API calls the frontend makes while browsing
   c. If LIVE JSON APIs were confirmed → supplement crawling with direct API calls via page.evaluate(fetch())
   d. HOMEPAGE CRAWL — always start from the homepage if the target URL has limited content, follow all content links
   e. SITEMAP — check /sitemap.xml for a complete list of pages to crawl
   f. DOM extraction as the primary per-page extraction method during crawling

8. ALTERNATIVE CRAWLING APPROACHES:
   - List backup crawling paths (different entry pages, category pages, search pages)
   - Suggest URL patterns for programmatic crawling (e.g., /page/1, /page/2)
   - Identify the homepage URL and category/section pages

IMPORTANT: Be specific. Reference actual URLs, selectors, and data. NEVER suggest giving up — always provide at least 3 crawling strategies.`;

    const analysis = await chatCompletion(modelId, [
      { role: "user", content: analysisPrompt },
    ], 0.2, 4096);

    emit({
      type: "analyzing",
      message: "Website analysis complete",
      detail: analysis.slice(0, 400) + (analysis.length > 400 ? "…" : ""),
      data: { analysis },
    });

    await sleep(300);

    // ── Step 3: Endpoint discovery and mapping (always run) ────────────────
    const liveApiCount = liveApiEndpoints.length;
    emit({
      type: "discovering",
      message: liveApiCount > 0
        ? `Mapping ${liveApiCount} confirmed live API endpoint(s)`
        : (isDataApi ? "Mapping authentication & data endpoints" : "Probing for API endpoints"),
      detail: `${endpointCount} endpoint(s) in HTML · ${liveApiCount} live JSON API(s) confirmed · AI mapping how to use them…`,
    });

    const endpointPrompt = `You are an API reverse-engineering expert. Your job is to find and map ALL usable API endpoints for data extraction. Be AGGRESSIVE — always look for API-based approaches first.

Website URL: ${websiteUrl}
${isDataApi ? `Authentication mode: The user wants to extract per-user/authenticated data.\nCredentials available: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", token" : ""}${credentials?.cookies ? ", cookies" : ""}` : "Public data mode: Extract publicly available data."}
${isCloudflareBlocked ? "\n⚠️ CLOUDFLARE DETECTED: Plain HTTP requests are blocked. ALL requests must go through Playwright browser. Use page.evaluate(() => fetch('/api/...')) or intercept network responses." : ""}

=== DISCOVERED ENDPOINTS FROM HTML ===
${discoveredEndpointsText || "No endpoints discovered in static HTML."}

=== PROBED API ENDPOINTS (actual HTTP responses) ===
${probedApiText || "No API endpoints were successfully probed."}

${liveApiEndpoints.length > 0 ? `=== ✅ CONFIRMED LIVE JSON APIs ===\n${liveApiEndpoints.map((ep) => `URL: ${ep.url}\nSample data: ${ep.sampleData.slice(0, 1500)}`).join("\n\n")}\n\nThese APIs are CONFIRMED WORKING and return real JSON data. The scraper MUST use these as the PRIMARY data source.` : ""}

=== INLINE DATA/STATE ===
${inlineDataText || "No inline JSON data found."}

=== SCRIPT SOURCES ===
${pageReport.includes("Script Sources") ? pageReport.slice(pageReport.indexOf("Script Sources"), pageReport.indexOf("---", pageReport.indexOf("Script Sources") + 20) > 0 ? pageReport.indexOf("---", pageReport.indexOf("Script Sources") + 20) : pageReport.indexOf("Script Sources") + 500) : "No external scripts found."}

=== ANALYSIS ===
${analysis.slice(0, 2000)}

For each usable endpoint, provide:
1. Full URL (resolve relative paths against ${websiteUrl})
2. HTTP method
3. Required headers (Content-Type, Authorization format, User-Agent, etc.)
4. Query parameters or request body format
5. Expected response structure (based on actual sample data if available)
6. Pagination mechanism (if applicable)

${isDataApi ? "Also describe the authentication flow:\n- Which endpoint handles login/auth?\n- What is the request body format?\n- How are session tokens returned (cookies, headers, JSON body)?\n- How to pass the token to subsequent data endpoints?" : ""}

STRATEGY PRIORITY:
1. If live JSON APIs were confirmed → these are the PRIMARY data source
2. If other API endpoints were discovered → describe how to call them via Playwright
3. If Cloudflare is present → ALL requests must go through Playwright's browser context
4. Network interception via Playwright → describe patterns to intercept (e.g. page.on('response'))
5. DOM extraction → only as a LAST RESORT

ONLY describe endpoints that actually appear in the discovered data. Do NOT invent endpoints.`;

    const endpointMap = await chatCompletion(modelId, [
      { role: "user", content: endpointPrompt },
    ], 0.2, 3072);

    emit({
      type: "discovering",
      message: "Endpoint mapping complete",
      detail: endpointMap.slice(0, 300) + (endpointMap.length > 300 ? "…" : ""),
      data: { endpointMap },
    });

    await sleep(300);

    // ── Step 4: Schema generation based on REAL data ─────────────────────────
    emit({
      type: "thinking",
      message: "Generating data schema from real page content",
      detail: "Inferring fields from actual data found on the page…",
    });

    const liveApiSample = liveApiEndpoints.length > 0
      ? `\n\nLive API sample data:\n${liveApiEndpoints[0].sampleData.slice(0, 2000)}\n\nUse the actual field names from this API response.`
      : "";

    const schemaPrompt = `Based on the REAL data found on this website, generate a JSON schema that describes each record the scraper will extract.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Analysis: ${analysis.slice(0, 1500)}

IMPORTANT: The schema fields MUST correspond to actual data visible in the fetched page content. Do not include fields that don't exist on this website.

If the page content is minimal or you cannot see specific data fields, generate a REASONABLE schema based on the site type and the user's instructions. For example, if the user wants comics data from a comics site, include fields like: title, url, coverImage, author, genres, status, latestChapter, description, rating.

ALWAYS include at least these baseline fields appropriate to the content type:
- A title/name field
- A url/link field
- An image/thumbnail field (if the site has images)
- A description/summary field
- Any category/tag/genre fields

${inlineDataText ? `Inline data found:\n${inlineDataText.slice(0, 2000)}\n\nUse the actual field names from this data where possible.` : ""}${liveApiSample}

Return ONLY a valid JSON object representing one extracted record. Use camelCase field names. No explanation, no markdown fences.`;

    const schemaRaw = await chatCompletion(modelId, [
      { role: "user", content: schemaPrompt },
    ], 0.2, 1024);

    let schema: Record<string, unknown> = {};
    try {
      const jsonMatch = schemaRaw.match(/\{[\s\S]*\}/);
      schema = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      schema = {};
    }

    const schemaFieldCount = Object.keys(schema).length;
    const hasNonEmptyValues = Object.values(schema).some((v) => v !== "" && v !== null && v !== undefined);

    if (schemaFieldCount < 3 || !hasNonEmptyValues) {
      emit({
        type: "crawling",
        message: "Schema too sparse — re-analyzing with crawling focus",
        detail: `Only ${schemaFieldCount} field(s) found. Re-generating schema based on user instructions and site type…`,
      });

      const retrySchemaPrompt = `The initial page analysis did not find enough structured data. Generate a comprehensive JSON schema anyway, based on:

1. The website type (URL: ${websiteUrl})
2. The user's extraction goal: "${instructions}"
3. Common data fields for this type of site

The scraper will CRAWL the site using Playwright — navigating to the homepage, following links to content pages, and extracting data from each page. Even if the initial page was sparse, the crawled pages will have data.

Generate a RICH schema with at least 6-8 fields that the crawler should extract from each content page. Include:
- title/name
- url/link
- image/coverImage/thumbnail
- description/summary
- category/genre/tags (as array)
- author/creator (if applicable)
- date/publishedAt (if applicable)
- rating/score (if applicable)
- Any fields specific to the content type

Return ONLY a valid JSON object. Use camelCase. No explanation, no markdown fences.`;

      const retrySchemaRaw = await chatCompletion(modelId, [
        { role: "user", content: retrySchemaPrompt },
      ], 0.3, 1024);

      try {
        const jsonMatch = retrySchemaRaw.match(/\{[\s\S]*\}/);
        const retrySchema = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (retrySchema && Object.keys(retrySchema).length > schemaFieldCount) {
          schema = retrySchema;
        }
      } catch {}

      if (Object.keys(schema).length < 3) {
        schema = { title: "", url: "", description: "", image: "", tags: [] };
      }
    }

    emit({
      type: "analyzing",
      message: "JSON schema generated",
      detail: `${Object.keys(schema).length} fields identified`,
      data: { schema },
    });

    if (sessionId) {
      await updateSession(sessionId, { suggested_schema: schema });
    }

    await sleep(300);

    // ── Step 5: Crawl strategy planning ──────────────────────────────────────
    emit({
      type: "crawling",
      message: "Designing crawl strategy",
      detail: "Planning how to navigate and crawl the site for maximum data coverage…",
    });

    const crawlPlanPrompt = `You are an expert web crawler engineer. Design a detailed crawling strategy for extracting data from this website using Playwright.

Website URL: ${websiteUrl}
User goal: ${instructions}
Data schema: ${JSON.stringify(schema, null, 2)}

=== SITE ANALYSIS ===
${analysis.slice(0, 2000)}

=== DISCOVERED ENDPOINTS ===
${discoveredEndpointsText || "None found in static HTML"}

=== HTML STRUCTURE ===
${fetchedHtmlSnippet.slice(0, 4000)}

Design a COMPLETE crawling plan:

1. ENTRY POINT: Where should the crawler start? (homepage, specific category page, search page, or the target URL)

2. LINK DISCOVERY: How to find links to content pages from the entry point.
   - What CSS selectors identify links to content/detail pages?
   - Are there category/section navigation links to follow first?
   - What URL patterns indicate content pages vs. navigation pages?

3. CRAWL DEPTH & PATTERN:
   - Level 1: Entry page → find listing/category links
   - Level 2: Category pages → find individual item links
   - Level 3: Item detail pages → extract full data
   - Describe the specific navigation path

4. PAGINATION: How to crawl through paginated listings.
   - What selector finds the "next page" link?
   - Is there a URL pattern (e.g., ?page=N, /page/N)?
   - Maximum pages to crawl per listing

5. DETAIL PAGE EXTRACTION: For each content page, what to extract.
   - Map each schema field to specific CSS selectors or page.evaluate() code
   - How to extract arrays (genres, tags, images)
   - How to handle missing fields

6. NETWORK INTERCEPTION: During crawling, what API responses to capture.
   - page.on('response') patterns to watch for
   - JSON endpoints that fire when pages load

7. FALLBACK STRATEGIES (in order):
   a. If target URL has no links → try the homepage
   b. If homepage has no links → try /sitemap.xml
   c. If sitemap unavailable → try common URL patterns (/comics, /manga, /posts, /articles, etc.)
   d. If still no data → intercept ALL network responses for JSON data while browsing

8. RATE LIMITING: Delays between requests, max concurrent pages, respectful crawling.

Be specific — use real CSS selectors and URL patterns from the HTML above.`;

    const crawlPlan = await chatCompletion(modelId, [
      { role: "user", content: crawlPlanPrompt },
    ], 0.2, 3072);

    emit({
      type: "crawling",
      message: "Crawl strategy designed",
      detail: crawlPlan.slice(0, 400) + (crawlPlan.length > 400 ? "…" : ""),
      data: { crawlPlan },
    });

    await sleep(300);

    // ── Step 6: Technical specification ───────────────────────────────────────
    emit({
      type: "refining",
      message: "Writing crawl-first technical specification",
      detail: "Creating detailed extraction plan with crawling as the primary strategy…",
    });

    const refinePrompt = `You are a senior ${langLabel} developer specializing in web crawling and scraping with Playwright. Write a precise technical specification for a ${isDataApi ? "DATA API extraction" : "web crawler/scraper"} script.

CRITICAL RULES:
1. CRAWLING IS THE PRIMARY STRATEGY. The scraper must navigate the site like a real user — loading pages, clicking links, following pagination.
2. ALL requests go through Playwright browser (page.goto, page.click, page.evaluate). NEVER use raw fetch/axios/requests.
3. The crawler must NEVER give up — if one approach fails, try the next. Cycle through ALL strategies before finishing.
4. If the initial page has no useful data, the crawler MUST navigate to the homepage, follow links, and crawl deeper.
${isCloudflareBlocked ? "5. ⚠️ CLOUDFLARE IS ACTIVE — Playwright handles this automatically with its real browser." : ""}

Website URL: ${websiteUrl}
Instructions: ${instructions}
Extraction Mode: ${isDataApi ? "DATA API (authenticated/user data)" : "SCRAPER (public data)"}
Data schema: ${JSON.stringify(schema, null, 2)}

=== SITE ANALYSIS ===
${analysis.slice(0, 2000)}

=== CRAWL STRATEGY ===
${crawlPlan.slice(0, 2000)}

=== DISCOVERED ENDPOINTS ===
${discoveredEndpointsText || "None found in static HTML"}

=== PROBED API ENDPOINTS ===
${probedApiText || "No endpoints probed"}

${liveApiEndpoints.length > 0 ? `=== ✅ CONFIRMED LIVE JSON APIs ===\n${liveApiEndpoints.map((ep) => `URL: ${ep.url}\nSample: ${ep.sampleData.slice(0, 1000)}`).join("\n\n")}\n\nSupplement crawling with these confirmed APIs.` : ""}

=== INLINE DATA ===
${inlineDataText ? inlineDataText.slice(0, 2000) : "None found"}

=== ENDPOINT MAP ===
${endpointMap.slice(0, 2000)}

=== HTML SNIPPET ===
${fetchedHtmlSnippet.slice(0, 6000)}

Write a detailed spec covering:

1. CRAWLING STRATEGY (PRIMARY — this is the most important part):
   a. Start at ${websiteUrl} — load the page in Playwright
   b. Enable network interception (page.on('response')) to capture ALL JSON API responses during browsing
   c. Extract listing links — find all links to content/detail pages using CSS selectors
   d. Follow pagination — crawl through all available pages of listings
   e. Visit each detail page — navigate to individual content pages and extract full data
   f. HOMEPAGE CRAWL — if the target URL has insufficient content, navigate to the site homepage and repeat the crawl
   g. SITEMAP FALLBACK — check /sitemap.xml for URLs to crawl

2. PER-PAGE EXTRACTION:
   - For each crawled page, extract data matching the schema fields
   - Use multiple CSS selector fallbacks per field
   - Capture intercepted API data as a supplement to DOM extraction

3. ${isDataApi ? "AUTHENTICATION FLOW — authenticate before crawling." : "PUBLIC DATA ACCESS"}

4. PAGINATION — crawl through pages using next-page links or URL patterns

5. ERROR HANDLING — retry each page load 3 times, continue crawling on individual page failures

6. RESULT VALIDATION — after crawling, check if results are sufficient. If not, try alternative crawl paths.

7. OUTPUT — JSON with envelope: { total_items, scraped_at, source_url, items: [...] }

Do not include comments in code snippets.`;

    let refinedPrompt = await chatCompletion(modelId, [
      { role: "user", content: refinePrompt },
    ], 0.3, 3072);

    const specMentionsNoData = /no data|no results|insufficient|unable to find|cannot extract|empty|nothing found/i.test(refinedPrompt);

    if (specMentionsNoData) {
      emit({
        type: "crawling",
        message: "Specification indicates insufficient data — enhancing crawl plan",
        detail: "Re-refining with deeper crawling approach: homepage crawl, sitemap, network interception…",
      });

      const enhancedRefinePrompt = `The initial technical specification indicated that data might be hard to find. Write an ENHANCED specification that is MORE AGGRESSIVE about crawling.

The crawler MUST:
1. Start at the HOMEPAGE of the site (not just the target URL)
2. Follow ALL content links it can find (articles, posts, items, products, etc.)
3. Intercept ALL JSON network responses while crawling
4. Try /sitemap.xml for a complete URL list
5. Try common content paths: /api, /feed, /rss, /search, /browse, /latest, /popular
6. Extract data from EVERY page it visits, even if it's not a "detail" page
7. Use page.evaluate() to check for window.__NEXT_DATA__, ld+json, and other inline data on every page

Website: ${websiteUrl}
Goal: ${instructions}
Schema: ${JSON.stringify(schema, null, 2)}
Previous analysis: ${analysis.slice(0, 1500)}
Crawl plan: ${crawlPlan.slice(0, 1500)}
HTML snippet: ${fetchedHtmlSnippet.slice(0, 4000)}

Write the enhanced technical specification for aggressive Playwright crawling. No comments.`;

      const enhancedSpec = await chatCompletion(modelId, [
        { role: "user", content: enhancedRefinePrompt },
      ], 0.3, 3072);

      if (enhancedSpec.length > refinedPrompt.length * 0.5) {
        refinedPrompt = refinedPrompt + "\n\n=== ENHANCED CRAWL STRATEGY ===\n" + enhancedSpec;
        emit({
          type: "refining",
          message: "Enhanced crawl specification ready",
          detail: enhancedSpec.slice(0, 300) + (enhancedSpec.length > 300 ? "…" : ""),
          data: { refinedPrompt },
        });
      }
    } else {
      emit({
        type: "refining",
        message: "Technical specification complete",
        detail: refinedPrompt.slice(0, 300) + (refinedPrompt.length > 300 ? "…" : ""),
        data: { refinedPrompt },
      });
    }

    if (sessionId) {
      await updateSession(sessionId, { refined_prompt: refinedPrompt });
    }

    await sleep(300);

    // ── Step 7: Generate validation test snippet ─────────────────────────────
    emit({
      type: "testing",
      message: "Generating crawl validation test",
      detail: "AI writing a test to verify the crawling and extraction approach…",
    });

    const testPrompt = `You are a senior ${langLabel} developer. Write a MINIMAL test snippet that verifies the web crawling approach will work for this website.

Website URL: ${websiteUrl}
Crawl strategy from spec: ${refinedPrompt.slice(0, 2000)}
Crawl plan: ${crawlPlan.slice(0, 1000)}
Discovered endpoints: ${discoveredEndpointsText || "None — DOM crawling"}
${probedApiText ? `\nProbed API responses:\n${probedApiText.slice(0, 1000)}` : ""}

The test MUST use Playwright (since the full scraper will crawl with Playwright). It should:
${isTs ? `
1. Launch Playwright browser and navigate to the target URL
2. Set up response interception (page.on('response')) to capture JSON APIs
3. Find content links on the page using querySelectorAll
4. Test that at least some links/content elements exist
5. Print PASS/FAIL with details about what was found (links count, intercepted APIs, DOM elements)
6. Be a standalone script that can run with: npx tsx test.ts` : `
1. Launch Playwright browser and navigate to the target URL
2. Set up response interception to capture JSON APIs
3. Find content links on the page using querySelectorAll
4. Test that at least some links/content elements exist
5. Print PASS/FAIL with details about what was found
6. Be a standalone script that can run with: python test.py`}

${isDataApi && credentials ? `Include authentication using the provided credentials format.` : ""}

RULES:
- ALWAYS use Playwright — the scraper will crawl with a real browser
- Do NOT include any comments
- Return ONLY raw ${langLabel} code, no markdown fences
- Keep it under 60 lines
- Use REAL URLs from the analysis`;

    const testSnippet = await chatCompletion(modelId, [
      { role: "user", content: testPrompt },
    ], 0.2, 2048);

    const cleanTest = testSnippet.replace(/^```(?:typescript|ts|python|py)?\n?/m, "").replace(/\n?```$/m, "");

    emit({
      type: "validating",
      message: "Crawl validation test generated",
      detail: `${cleanTest.split("\n").length} lines — verifies crawling approach before building the full scraper`,
      data: { testResult: cleanTest },
    });

    await sleep(300);

    // ── Step 8: Build the full crawler/scraper ───────────────────────────────
    emit({
      type: "building",
      message: `Building ${langLabel} ${isDataApi ? "data API extractor" : "web crawler"}`,
      detail: `Generating production-ready .${ext} crawler based on real page analysis and crawl strategy…`,
    });

    await sleep(400);

    const baseFile = isDataApi
      ? (isTs
        ? generateDataApiTemplate(websiteUrl, schema, instructions, credentials)
        : generateDataApiPyTemplate(websiteUrl, schema, instructions, credentials))
      : (isTs
        ? generateApiFileTemplate(websiteUrl, schema, instructions)
        : generatePyFileTemplate(websiteUrl, schema, instructions));

    const TEMPLATE_PREVIEW_LINES = 60;
    const enhancePrompt = `You are a senior ${langLabel} web crawling and scraping engineer. Write a complete, production-ready ${langLabel} script that CRAWLS and extracts structured data from the target website using Playwright.

OUTPUT RULES:
- Return ONLY raw ${langLabel} source code. No markdown fences, no explanation, no comments, no docstrings.
- The script must be fully self-contained — the user just runs it.
- The script MUST use Playwright to crawl the website (navigate pages, follow links, extract data).

=== TARGET WEBSITE ===
URL: ${websiteUrl}
User instructions: ${instructions}
Mode: ${isDataApi ? "DATA API (authenticated)" : "SCRAPER (public data)"}
Output schema: ${JSON.stringify(schema, null, 2)}
${isCloudflareBlocked ? "\n⚠️ CLOUDFLARE PROTECTED — ALL requests MUST go through Playwright browser." : ""}

=== CRAWL STRATEGY ===
${crawlPlan.slice(0, 2000)}

=== DISCOVERED API ENDPOINTS (${endpointCount}) ===
${discoveredEndpointsText || "None discovered in static HTML."}

=== PROBED API ENDPOINTS (actual responses) ===
${probedApiText || "No endpoints probed."}

${liveApiEndpoints.length > 0 ? `=== ✅ CONFIRMED LIVE JSON APIs ===\n${liveApiEndpoints.map((ep) => `URL: ${ep.url}\nSample data: ${ep.sampleData.slice(0, 1500)}`).join("\n\n")}\n\nSupplement crawling with these confirmed APIs.` : ""}

=== INLINE JSON DATA ===
${inlineDataText ? inlineDataText.slice(0, 3000) : "None found."}

=== ENDPOINT MAP ===
${endpointMap.slice(0, 2000)}

=== REAL HTML STRUCTURE ===
${fetchedHtmlSnippet.slice(0, 12000)}

=== TECHNICAL SPECIFICATION ===
${refinedPrompt.slice(0, 3000)}

=== VALIDATION TEST ===
${cleanTest.slice(0, 1500)}

${isDataApi ? `=== AUTHENTICATION ===
Credentials available: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", API token" : ""}${credentials?.cookies ? ", cookies" : ""}
Use the actual auth endpoints discovered above to authenticate, then crawl per-user data.
` : ""}

=== MANDATORY IMPLEMENTATION REQUIREMENTS ===

1. CRAWLING IS THE PRIMARY STRATEGY (MOST IMPORTANT):
   The script MUST be a web CRAWLER that navigates the site systematically:
   a. Launch Playwright browser and navigate to ${websiteUrl}
   b. Set up network interception: page.on('response') to capture ALL JSON API responses during crawling
   c. DISCOVER LINKS — find all links to content/detail pages on the current page:
      - Use selectors: article a[href], [class*='card'] a[href], [class*='item'] a[href], [class*='title'] a[href], h2 a[href], h3 a[href]
      - Filter out navigation, footer, and non-content links
      - Resolve relative URLs to absolute
   d. CRAWL DETAIL PAGES — navigate to each discovered link and extract data:
      - Load each detail page with page.goto()
      - Extract ALL schema fields using CSS selectors
      - Also check for intercepted API data from network responses
   e. PAGINATE — after processing all detail links on the current listing page:
      - Find the next page link (a[rel='next'], a[class*='next'], [class*='pagination'] a:last-child)
      - Navigate to it and repeat the crawl
   f. HOMEPAGE FALLBACK — if the target URL has few/no content links:
      - Navigate to the site homepage (new URL("/", startUrl).href)
      - Repeat the crawl from there
   g. SITEMAP FALLBACK — try fetching /sitemap.xml and parse URLs from it
   h. NETWORK DATA — check all intercepted JSON responses for arrays of data matching the schema

2. PER-PAGE EXTRACTION:
   - On every crawled page, extract data for each schema field
   - Use safeExtract() with multiple CSS selector fallbacks per field
   - Extract from intercepted network responses (JSON APIs) if available
   - Check for __NEXT_DATA__, ld+json, window.__STATE__ inline data
   - Handle missing fields gracefully with fillMissingFields()

3. ROBUST ERROR HANDLING:
   - Wrap ALL selector operations in try/catch blocks
   - Implement a safeExtract() helper that tries multiple fallback selectors
   - Add retry logic with exponential backoff for page loads (at least 3 retries)
   - Handle missing elements gracefully (return empty string, not crash)
   - Log errors but continue crawling
   - If a page fails, skip it and continue to the next

4. COMPLETE DATA FIELDS — every schema field MUST be populated:
   - For ID fields: generate from URL hash if not found
   - For "provider"/"source" fields: set to the website hostname
   - For "url"/"link" fields: use the current page URL
   - For date fields: extract from page or use current timestamp
   - For array fields: use dedicated extraction with proper selectors
   - Deduplicate results by URL or ID before output

5. CRAWL CONTROL:
   - CONFIG.maxPages limits total listing pages to crawl
   - CONFIG.requestDelay adds delay between page navigations
   - Maximum 50 detail pages per listing page
   - Track visited URLs to avoid re-crawling

6. FILE OUTPUT:
   - Save results as JSON envelope: { total_items, scraped_at, source_url, items: [...] }
   - Save to output-YYYY-MM-DD.json using ${isTs ? "fs.writeFileSync" : "json.dump to a file"}
   - Also print to stdout as formatted JSON

7. CODE QUALITY:
   - ${isTs ? "Use strict TypeScript types — explicit type annotations on ALL function parameters and callbacks" : "Use Python type hints throughout"}
   - ${isTs ? "import { chromium, Browser, Page } from 'playwright' and import * as fs from 'fs'" : "from playwright.sync_api import sync_playwright, Page, Browser and import json, time, hashlib"}
   - Clean class-based structure with init(), scrape(), close()
   - No comments anywhere in the code

REFERENCE TEMPLATE (use as structural guide, but replace ALL generic selectors with real ones from the HTML above):
\`\`\`${isTs ? "typescript" : "python"}
${baseFile.split("\n").slice(0, TEMPLATE_PREVIEW_LINES).join("\n")}
... (template continues with safeExtract, extractImages, extractGenres, getDetailLinks, extractDetailPage, tryHomepageFallback, pagination, deduplication, file output)
\`\`\`

Write the COMPLETE ${langLabel} file now. This is a WEB CRAWLER — it MUST navigate the site, follow links, visit detail pages, and extract data from each. Use REAL selectors from the HTML above. NEVER give up — always try homepage fallback and sitemap.`;

    let apiFileContent = baseFile;
    const streamParts: string[] = [];

    emit({
      type: "generating",
      message: `Streaming ${langLabel} crawler code`,
      detail: `AI writing your custom ${isDataApi ? "data API extractor" : "web crawler"} based on crawl strategy and page analysis…`,
    });

    try {
      for await (const chunk of streamCompletion(
        modelId,
        [{ role: "user", content: enhancePrompt }],
        0.2,
        16384
      )) {
        streamParts.push(chunk);
        sendSSE(res, "code_chunk", { chunk });
      }
      let enhanced = streamParts.join("");
      if (enhanced.length > 500) {
        const OPENING_FENCE = /^```(?:typescript|ts|python|py|javascript|js)?\s*\n?/gm;
        const CLOSING_FENCE = /\n?```\s*$/gm;
        enhanced = enhanced
          .replace(OPENING_FENCE, "")
          .replace(CLOSING_FENCE, "")
          .trim();
        if (enhanced.length > 500) {
          apiFileContent = enhanced;
        }
      }
    } catch (err) {
      console.warn("Stream failed, using base template:", err);
    }

    if (sessionId) {
      await updateSession(sessionId, { generated_api_file: apiFileContent });
    }

    emit({
      type: "complete",
      message: `${isDataApi ? "Data API extractor" : "Web crawler"} file ready`,
      detail: `${apiFileContent.split("\n").length} lines of ${langLabel} generated · Crawl-first strategy · ${endpointCount} API endpoint(s) supplementing crawl`,
      data: {
        apiFile: apiFileContent,
        schema,
        refinedPrompt,
        analysis,
      },
    });

    sendSSE(res, "done", { sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    emit({
      type: "error",
      message: "Agent session failed",
      detail: message,
    });
    sendSSE(res, "error", { message });
  } finally {
    res.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
