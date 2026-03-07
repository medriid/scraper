import { Response } from "express";
import { chatCompletion, streamCompletion } from "./aiService.js";
import { generateApiFileTemplate, generatePyFileTemplate, generateDataApiTemplate, generateDataApiPyTemplate } from "../templates/apiTemplate.js";
import { updateSession } from "./supabaseService.js";
import { fetchAndAnalyzePage, buildPageReport, FetchedPage, crawlSiteForDiscovery, BotCrawlResult } from "./pageFetcher.js";

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

    // ── Step 3: Bot Crawl — actually visit pages with Playwright ─────────────
    emit({
      type: "crawling",
      message: "Bot crawling site with Playwright",
      detail: "Launching headless browser to visit pages, discover real selectors, and capture live data…",
    });

    let botCrawlResult: BotCrawlResult | null = null;
    let botCrawlReport = "";

    try {
      botCrawlResult = await crawlSiteForDiscovery(
        websiteUrl,
        page ? page.linkUrls : [],
        3
      );

      botCrawlReport = botCrawlResult.siteStructure;

      const crawledPageCount = botCrawlResult.pages.length;
      const detailUrlCount = botCrawlResult.discoveredDetailUrls.length;
      const interceptedApiCount = botCrawlResult.allInterceptedApis.length;

      emit({
        type: "crawling",
        message: `Bot crawled ${crawledPageCount} page(s)`,
        detail: `Found ${detailUrlCount} detail link(s) · ${interceptedApiCount} API call(s) intercepted · Discovered real selectors and data`,
      });

      if (crawledPageCount === 0 || (detailUrlCount === 0 && interceptedApiCount === 0)) {
        emit({
          type: "crawling",
          message: "Insufficient data — crawling homepage",
          detail: "Target page had limited content. Crawling the homepage for more data…",
        });

        const homeUrl = new URL("/", websiteUrl).href;
        if (homeUrl !== websiteUrl) {
          try {
            const homeCrawl = await crawlSiteForDiscovery(homeUrl, [], 2);
            if (homeCrawl.pages.length > 0) {
              botCrawlResult.pages.push(...homeCrawl.pages);
              botCrawlResult.allInterceptedApis.push(...homeCrawl.allInterceptedApis);
              botCrawlResult.discoveredDetailUrls.push(...homeCrawl.discoveredDetailUrls);
              botCrawlReport += "\n\n=== HOMEPAGE CRAWL ===\n" + homeCrawl.siteStructure;

              emit({
                type: "crawling",
                message: `Homepage crawl found ${homeCrawl.pages.length} more page(s)`,
                detail: `${homeCrawl.discoveredDetailUrls.length} detail link(s) · ${homeCrawl.allInterceptedApis.length} API(s) intercepted`,
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      emit({
        type: "crawling",
        message: "Bot crawl encountered issues",
        detail: `Continuing with initial page data. Error: ${err instanceof Error ? err.message : "Unknown"}`,
      });
    }

    await sleep(300);

    // ── Step 4: Schema generation based on REAL crawl data ───────────────────
    emit({
      type: "thinking",
      message: "Generating data schema from real crawl data",
      detail: "Inferring fields from actual data discovered by the bot crawler…",
    });

    const liveApiEndpointsFromCrawl = botCrawlResult?.allInterceptedApis ?? [];
    const allLiveApis = [...liveApiEndpoints, ...liveApiEndpointsFromCrawl];
    const crawlSampleData = botCrawlResult?.pages
      .map((p) => {
        const texts = Object.entries(p.sampleTexts)
          .map(([k, v]) => `${k}: "${v}"`)
          .join(", ");
        return texts ? `Page ${p.url}: ${texts}` : "";
      })
      .filter(Boolean)
      .join("\n") ?? "";

    const liveApiSample = allLiveApis.length > 0
      ? `\n\nLive API sample data:\n${allLiveApis[0].sampleData.slice(0, 2000)}\n\nUse the actual field names from this API response.`
      : "";

    const schemaPrompt = `Based on the REAL data found by crawling this website with a headless browser, generate a JSON schema that describes each record the scraper will extract.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Analysis: ${analysis.slice(0, 1500)}

=== REAL DATA DISCOVERED BY BOT CRAWLER ===
${crawlSampleData || "Bot crawler did not extract sample text data."}

=== BOT CRAWL STRUCTURAL REPORT ===
${botCrawlReport.slice(0, 4000)}

IMPORTANT: The schema fields MUST correspond to actual data visible in the crawled pages. Do not include fields that don't exist on this website.

If the bot crawler found sample texts (title, description, genre, rating, etc.), use those exact field names.
If the bot crawler found specific data values, those confirm what fields exist on the site.

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
        message: "Schema too sparse — re-analyzing with crawl findings",
        detail: `Only ${schemaFieldCount} field(s) found. Re-generating schema based on user instructions and bot crawl data…`,
      });

      const retrySchemaPrompt = `The initial page analysis did not find enough structured data. Generate a comprehensive JSON schema based on:

1. The website type (URL: ${websiteUrl})
2. The user's extraction goal: "${instructions}"
3. Real data found by crawling: ${crawlSampleData.slice(0, 1000) || "No sample data available"}
4. Common data fields for this type of site

The scraper will CRAWL the site using Playwright. Generate a RICH schema with at least 6-8 fields.

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

    // ── Step 5: Technical specification with real crawl data ─────────────────
    emit({
      type: "refining",
      message: "Writing technical specification with real crawl data",
      detail: "Creating detailed extraction plan using real selectors and data discovered by the bot crawler…",
    });

    const realSelectorsReport = botCrawlResult?.pages
      .map((p) => {
        const selectorLines = p.contentSelectors
          .filter((s) => s.count > 0 && (s.sampleText || s.sampleHref || s.sampleSrc))
          .slice(0, 20)
          .map((s) => {
            let line = `  "${s.selector}" → ${s.count}×, <${s.tagName}>`;
            if (s.sampleText) line += `, text: "${s.sampleText.slice(0, 80)}"`;
            if (s.sampleHref) line += `, href: "${s.sampleHref}"`;
            if (s.sampleSrc) line += `, src: "${s.sampleSrc}"`;
            return line;
          })
          .join("\n");
        return selectorLines ? `Page ${p.url}:\n${selectorLines}` : "";
      })
      .filter(Boolean)
      .join("\n\n") ?? "";

    const detailUrlExamples = botCrawlResult?.discoveredDetailUrls.slice(0, 10).join("\n  ") ?? "";

    const refinePrompt = `You are a senior ${langLabel} developer specializing in web crawling and scraping with Playwright. Write a precise technical specification for a ${isDataApi ? "DATA API extraction" : "web crawler/scraper"} script.

CRITICAL: A bot crawler has ALREADY visited the actual website and discovered REAL selectors and data. You MUST use these real selectors — do NOT guess or use generic selectors.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Extraction Mode: ${isDataApi ? "DATA API (authenticated)" : "SCRAPER (public data)"}
Data schema: ${JSON.stringify(schema, null, 2)}
${isCloudflareBlocked ? "\n⚠️ CLOUDFLARE IS ACTIVE — ALL requests must go through Playwright browser." : ""}

=== REAL SELECTORS DISCOVERED BY BOT CRAWLER ===
${realSelectorsReport || "Bot crawler did not find specific selectors."}

=== REAL DETAIL PAGE URLs ===
${detailUrlExamples ? `  ${detailUrlExamples}` : "No detail URLs discovered."}

=== REAL SAMPLE DATA FROM CRAWLED PAGES ===
${crawlSampleData || "No sample data extracted."}

=== BOT CRAWL FULL REPORT ===
${botCrawlReport.slice(0, 3000)}

=== INTERCEPTED API CALLS DURING CRAWL ===
${botCrawlResult?.allInterceptedApis.slice(0, 5).map((api) => `[${api.method}] ${api.url} → ${api.statusCode}\n  Sample: ${api.sampleData.slice(0, 500)}`).join("\n") ?? "None intercepted."}

=== SITE ANALYSIS ===
${analysis.slice(0, 1500)}

=== DISCOVERED ENDPOINTS ===
${discoveredEndpointsText || "None found in static HTML"}

=== PROBED API ENDPOINTS ===
${probedApiText || "No endpoints probed"}

${allLiveApis.length > 0 ? `=== ✅ CONFIRMED LIVE JSON APIs ===\n${allLiveApis.slice(0, 3).map((ep) => `URL: ${ep.url}\nSample: ${ep.sampleData.slice(0, 800)}`).join("\n\n")}\n\nSupplement crawling with these confirmed APIs.` : ""}

=== HTML SNIPPET FROM CRAWLED PAGES ===
${botCrawlResult?.pages[0]?.htmlSnippet.slice(0, 6000) ?? fetchedHtmlSnippet.slice(0, 6000)}

Write the technical specification. IMPORTANT RULES:
1. Use the REAL CSS selectors listed above — the bot crawler already verified they exist on the site
2. Reference the actual sample data and URLs the bot found
3. Map each schema field to a SPECIFIC real selector from the crawl report
4. Include the real detail page URL pattern based on discovered URLs
5. CRAWLING IS THE PRIMARY STRATEGY — navigate pages, follow links, extract data
6. ALL requests through Playwright browser
7. ${isDataApi ? "AUTHENTICATION FLOW — authenticate before crawling." : ""}
8. If a field does not have a clear selector, note it explicitly and suggest alternatives

No comments in code snippets.`;

    let refinedPrompt = await chatCompletion(modelId, [
      { role: "user", content: refinePrompt },
    ], 0.3, 3072);

    emit({
      type: "refining",
      message: "Technical specification complete",
      detail: refinedPrompt.slice(0, 300) + (refinedPrompt.length > 300 ? "…" : ""),
      data: { refinedPrompt },
    });

    if (sessionId) {
      await updateSession(sessionId, { refined_prompt: refinedPrompt });
    }

    await sleep(300);

    // ── Step 6: Build the full crawler/scraper ───────────────────────────────
    emit({
      type: "building",
      message: `Building ${langLabel} ${isDataApi ? "data API extractor" : "web crawler"}`,
      detail: `Generating production-ready .${ext} crawler using real selectors from bot crawl…`,
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
- The script MUST use Playwright to crawl the website.

CRITICAL: A bot crawler has ALREADY visited the actual website and discovered REAL CSS selectors and data values. You MUST use these REAL selectors in your code. Do NOT use generic selectors like [class*='title'] when the bot found specific ones. The bot's findings are ground truth.

=== TARGET WEBSITE ===
URL: ${websiteUrl}
User instructions: ${instructions}
Mode: ${isDataApi ? "DATA API (authenticated)" : "SCRAPER (public data)"}
Output schema: ${JSON.stringify(schema, null, 2)}
${isCloudflareBlocked ? "\n⚠️ CLOUDFLARE PROTECTED — ALL requests MUST go through Playwright browser." : ""}

=== REAL SELECTORS FROM BOT CRAWLER (USE THESE!) ===
${realSelectorsReport || "No specific selectors discovered — use the HTML snippet below to identify them."}

=== REAL SAMPLE DATA FROM BOT CRAWLER ===
${crawlSampleData || "No sample data available."}

=== REAL DETAIL PAGE URLs FROM BOT CRAWLER ===
${detailUrlExamples ? `  ${detailUrlExamples}` : "No detail URLs discovered."}

=== BOT CRAWL REPORT ===
${botCrawlReport.slice(0, 3000)}

=== INTERCEPTED API CALLS (from bot crawl) ===
${botCrawlResult?.allInterceptedApis.slice(0, 5).map((api) => `[${api.method}] ${api.url} → ${api.statusCode}\n  Sample: ${api.sampleData.slice(0, 500)}`).join("\n") ?? "None intercepted."}

=== DISCOVERED API ENDPOINTS (from HTML) ===
${discoveredEndpointsText || "None discovered in static HTML."}

=== PROBED API ENDPOINTS (actual responses) ===
${probedApiText || "No endpoints probed."}

${allLiveApis.length > 0 ? `=== ✅ CONFIRMED LIVE JSON APIs ===\n${allLiveApis.slice(0, 3).map((ep) => `URL: ${ep.url}\nSample data: ${ep.sampleData.slice(0, 1000)}`).join("\n\n")}\n\nSupplement crawling with these confirmed APIs.` : ""}

=== INLINE JSON DATA ===
${inlineDataText ? inlineDataText.slice(0, 3000) : "None found."}

=== REAL HTML FROM CRAWLED PAGES ===
${botCrawlResult?.pages[0]?.htmlSnippet.slice(0, 12000) ?? fetchedHtmlSnippet.slice(0, 12000)}

=== TECHNICAL SPECIFICATION ===
${refinedPrompt.slice(0, 3000)}

${isDataApi ? `=== AUTHENTICATION ===
Credentials available: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", API token" : ""}${credentials?.cookies ? ", cookies" : ""}
Use the actual auth endpoints discovered above to authenticate, then crawl per-user data.
` : ""}

=== MANDATORY IMPLEMENTATION REQUIREMENTS ===

1. USE REAL SELECTORS (MOST IMPORTANT):
   The bot crawler already visited the site and discovered which CSS selectors contain actual data.
   You MUST use these real selectors in your code, NOT generic ones.
   For each schema field, find the matching selector from the bot crawl report and use it.

2. CRAWLING STRATEGY:
   a. Launch Playwright browser and navigate to ${websiteUrl}
   b. Set up network interception: page.on('response') to capture JSON API responses
   c. Find detail page links using the real selectors the bot discovered
   d. Visit each detail page and extract data using the real selectors
   e. Handle pagination
   f. HOMEPAGE FALLBACK — if target URL has limited content, try the homepage
   g. SITEMAP FALLBACK — try /sitemap.xml

3. PER-PAGE EXTRACTION:
   - Use the REAL selectors from the bot crawl report for each field
   - Also check intercepted API data
   - Handle missing fields gracefully with fillMissingFields()

4. ROBUST ERROR HANDLING:
   - try/catch on all selector operations
   - Retry page loads 3 times
   - Continue crawling on individual page failures

5. COMPLETE DATA FIELDS:
   - For ID fields: generate from URL hash if not found
   - For "provider"/"source" fields: set to the website hostname
   - For "url"/"link" fields: use the current page URL
   - Deduplicate results by URL or ID

6. FILE OUTPUT:
   - JSON envelope: { total_items, scraped_at, source_url, items: [...] }
   - Save to output-YYYY-MM-DD.json
   - Print to stdout as formatted JSON

7. CODE QUALITY:
   - ${isTs ? "Strict TypeScript types — explicit type annotations" : "Python type hints throughout"}
   - ${isTs ? "import { chromium, Browser, Page } from 'playwright'" : "from playwright.sync_api import sync_playwright"}
   - Class-based structure with init(), scrape(), close()
   - No comments anywhere

REFERENCE TEMPLATE (structural guide only — replace ALL selectors with real ones from bot crawl):
\`\`\`${isTs ? "typescript" : "python"}
${baseFile.split("\n").slice(0, TEMPLATE_PREVIEW_LINES).join("\n")}
... (template continues with safeExtract, extractImages, getDetailLinks, extractDetailPage, tryHomepageFallback, pagination, deduplication, file output)
\`\`\`

Write the COMPLETE ${langLabel} file now. Use REAL selectors from the bot crawl. NEVER use generic selectors when real ones are available.`;

    let apiFileContent = baseFile;
    const streamParts: string[] = [];

    emit({
      type: "generating",
      message: `Streaming ${langLabel} crawler code`,
      detail: `AI writing your custom ${isDataApi ? "data API extractor" : "web crawler"} using real selectors from bot crawl…`,
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
      detail: `${apiFileContent.split("\n").length} lines of ${langLabel} generated · Bot-crawl-informed · Real selectors used · ${endpointCount} API endpoint(s)`,
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
