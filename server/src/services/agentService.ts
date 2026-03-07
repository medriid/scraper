import { Response } from "express";
import { chatCompletion, streamCompletion } from "./aiService.js";
import { generateApiFileTemplate, generatePyFileTemplate, generateDataApiTemplate, generateDataApiPyTemplate } from "../templates/apiTemplate.js";
import { updateSession } from "./supabaseService.js";
import { fetchAndAnalyzePage, buildPageReport, FetchedPage, crawlSiteForDiscovery, CrawledPageReport } from "./pageFetcher.js";

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

interface AgentKnowledge {
  fetchedPages: FetchedPage[];
  crawledPages: CrawledPageReport[];
  interceptedApis: Array<{ url: string; sampleData: string; method: string }>;
  discoveredDetailUrls: string[];
  crawlReports: string[];
  visitedUrls: Set<string>;
  analysis: string;
  schema: Record<string, unknown> | null;
}

function sendSSE(res: Response, event: string, data: unknown): void {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

function buildKnowledgeSummary(k: AgentKnowledge): string {
  const lines: string[] = [];

  lines.push(`=== CRAWLED PAGES (${k.crawledPages.length}) ===`);
  for (const p of k.crawledPages) {
    lines.push(`\nPage: ${p.url}`);
    lines.push(`Title: ${p.title}`);
    if (Object.keys(p.sampleTexts).length > 0) {
      lines.push(`Sample data:`);
      for (const [field, text] of Object.entries(p.sampleTexts)) {
        lines.push(`  ${field}: "${text}"`);
      }
    }
    const meaningful = p.elements.filter(
      (e) => e.count > 0 && (e.sampleText || e.sampleHref || e.sampleSrc)
    );
    if (meaningful.length > 0) {
      lines.push(`Discovered DOM elements:`);
      for (const e of meaningful.slice(0, 25)) {
        let line = `  "${e.selector}" → ${e.count}×, <${e.tagName}>`;
        if (e.className) line += ` class="${e.className.slice(0, 50)}"`;
        if (e.sampleText) line += `, text: "${e.sampleText.slice(0, 80)}"`;
        if (e.sampleHref) line += `, href: "${e.sampleHref}"`;
        if (e.sampleSrc) line += `, src: "${e.sampleSrc}"`;
        lines.push(line);
      }
    }
    if (p.linkPatterns.length > 0) {
      lines.push(`Content links (${p.linkPatterns.length}):`);
      for (const link of p.linkPatterns.slice(0, 5)) {
        lines.push(`  ${link}`);
      }
    }
  }

  if (k.interceptedApis.length > 0) {
    lines.push(`\n=== INTERCEPTED APIs (${k.interceptedApis.length}) ===`);
    for (const api of k.interceptedApis.slice(0, 5)) {
      lines.push(`[${api.method}] ${api.url}`);
      lines.push(`  Sample: ${api.sampleData.slice(0, 500)}`);
    }
  }

  if (k.discoveredDetailUrls.length > 0) {
    lines.push(`\n=== DISCOVERED URLs (${k.discoveredDetailUrls.length}) ===`);
    for (const url of k.discoveredDetailUrls.slice(0, 10)) {
      lines.push(`  ${url}`);
    }
  }

  for (const fp of k.fetchedPages) {
    if (fp.inlineJsonData.length > 0) {
      lines.push(`\n=== INLINE DATA from ${fp.url} ===`);
      for (const d of fp.inlineJsonData.slice(0, 3)) {
        lines.push(d.slice(0, 1500));
      }
    }
    const liveApis = fp.probedEndpoints.filter((ep) => ep.isJsonApi);
    if (liveApis.length > 0) {
      lines.push(`\n=== LIVE JSON APIs from ${fp.url} ===`);
      for (const ep of liveApis.slice(0, 3)) {
        lines.push(`[${ep.method}] ${ep.url} → ${ep.statusCode}`);
        lines.push(`  Sample: ${ep.sampleData.slice(0, 800)}`);
      }
    }
  }

  if (k.schema) {
    lines.push(`\n=== CURRENT SCHEMA ===`);
    lines.push(JSON.stringify(k.schema, null, 2));
  }

  return lines.join("\n");
}

function buildElementsReport(crawledPages: CrawledPageReport[]): string {
  return crawledPages
    .map((p) => {
      const elLines = p.elements
        .filter((e) => e.count > 0 && (e.sampleText || e.sampleHref || e.sampleSrc))
        .slice(0, 25)
        .map((e) => {
          let line = `  "${e.selector}" → ${e.count}×, <${e.tagName}>`;
          if (e.className) line += ` class="${e.className.slice(0, 50)}"`;
          if (e.sampleText) line += `, text: "${e.sampleText.slice(0, 80)}"`;
          if (e.sampleHref) line += `, href: "${e.sampleHref}"`;
          if (e.sampleSrc) line += `, src: "${e.sampleSrc}"`;
          return line;
        })
        .join("\n");
      return elLines ? `Page ${p.url}:\n${elLines}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildCrawlSampleData(crawledPages: CrawledPageReport[]): string {
  return crawledPages
    .map((p) => {
      const texts = Object.entries(p.sampleTexts)
        .map(([k, v]) => `${k}: "${v}"`)
        .join(", ");
      return texts ? `Page ${p.url}: ${texts}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function mergeDiscovery(
  knowledge: AgentKnowledge,
  result: {
    pages: CrawledPageReport[];
    allInterceptedApis: Array<{ url: string; sampleData: string; method: string; statusCode: number; contentType: string; isJsonApi: boolean }>;
    discoveredDetailUrls: string[];
    siteStructure: string;
  }
): void {
  knowledge.crawledPages.push(...result.pages);
  knowledge.crawlReports.push(result.siteStructure);
  for (const u of result.discoveredDetailUrls) {
    if (!knowledge.discoveredDetailUrls.includes(u)) {
      knowledge.discoveredDetailUrls.push(u);
    }
  }
  for (const api of result.allInterceptedApis) {
    if (!knowledge.interceptedApis.some((a) => a.url === api.url)) {
      knowledge.interceptedApis.push({ url: api.url, sampleData: api.sampleData, method: api.method });
    }
  }
  for (const p of result.pages) {
    knowledge.visitedUrls.add(p.url);
  }
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

  const knowledge: AgentKnowledge = {
    fetchedPages: [],
    crawledPages: [],
    interceptedApis: [],
    discoveredDetailUrls: [],
    crawlReports: [],
    visitedUrls: new Set<string>(),
    analysis: "",
    schema: null,
  };

  const MAX_ITERATIONS = 6;

  try {
    // ── Step 1: Initial page fetch ──────────────────────────────────────────
    emit({
      type: "fetching",
      message: "Fetching target website",
      detail: `Making real HTTP request to ${websiteUrl}…`,
    });

    const tryFetchPage = async (url: string): Promise<FetchedPage | null> => {
      try { return await fetchAndAnalyzePage(url); } catch { return null; }
    };

    let page = await tryFetchPage(websiteUrl);
    let isCloudflareBlocked = false;

    if (page && page.isCloudflareBlocked) {
      isCloudflareBlocked = true;
      emit({
        type: "browsing",
        message: "Cloudflare protection detected",
        detail: "Will use Playwright to bypass. Trying alternative URLs…",
      });
      for (const altUrl of page.alternativeUrls.slice(0, 4)) {
        const altPage = await tryFetchPage(altUrl);
        if (altPage && !altPage.isCloudflareBlocked && altPage.html.length > 1000) {
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

    if (page) {
      knowledge.fetchedPages.push(page);
      knowledge.visitedUrls.add(websiteUrl);
      const liveApiCount = page.probedEndpoints.filter((ep) => ep.isJsonApi).length;
      emit({
        type: "browsing",
        message: "Page fetched successfully",
        detail: `Status ${page.statusCode} · ${page.discoveredEndpoints.length} endpoint(s) · ${liveApiCount} live API(s)${isCloudflareBlocked ? " · ⚠️ Cloudflare" : ""}`,
      });
    } else {
      isCloudflareBlocked = true;
      emit({
        type: "browsing",
        message: "Direct fetch failed — will use Playwright",
        detail: "Site requires browser rendering.",
      });
    }

    await sleep(300);

    // ── Step 2: Initial bot crawl ───────────────────────────────────────────
    emit({
      type: "crawling",
      message: "Bot crawling site with Playwright",
      detail: "Launching headless browser to dynamically discover page structure and data…",
    });

    try {
      const crawlResult = await crawlSiteForDiscovery(websiteUrl, page ? page.linkUrls : [], 3);
      mergeDiscovery(knowledge, crawlResult);
      emit({
        type: "crawling",
        message: `Bot crawled ${crawlResult.pages.length} page(s)`,
        detail: `${crawlResult.discoveredDetailUrls.length} content link(s) · ${crawlResult.allInterceptedApis.length} API(s) intercepted`,
      });
    } catch (err) {
      emit({
        type: "crawling",
        message: "Bot crawl encountered issues",
        detail: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
      });
    }

    await sleep(300);

    // ── Step 3: Initial AI analysis ─────────────────────────────────────────
    emit({
      type: "thinking",
      message: "AI analyzing crawl findings",
      detail: "Examining discovered DOM elements, intercepted APIs, and page structure…",
    });

    const pageReport = page ? buildPageReport(page) : "No page data — all fetches failed.";

    const analysisPrompt = `You are an expert web scraping engineer. Analyze the REAL data gathered from this website.

A bot crawler visited the site with Playwright and dynamically scanned the DOM — it discovered every CSS class, data attribute, and HTML element on each page. This is raw, unfiltered discovery. Your job is to interpret what was found and decide what's useful for extracting the user's requested data.

Website URL: ${websiteUrl}
User Instructions: ${instructions}
${isDataApi ? `Mode: DATA API (authenticated)\nCredentials: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", token" : ""}${credentials?.cookies ? ", cookies" : ""}` : "Mode: SCRAPER (public data)"}
${isCloudflareBlocked ? "\n⚠️ CLOUDFLARE — must use Playwright." : ""}

=== BOT CRAWLER FINDINGS ===
${buildKnowledgeSummary(knowledge)}

=== INITIAL HTTP FETCH REPORT ===
${pageReport.slice(0, 6000)}

Based ONLY on the actual data above, analyze:
1. SITE TYPE: What kind of site is this?
2. USEFUL ELEMENTS: Which of the discovered DOM elements/classes contain the data the user wants? Map them to likely data fields.
3. REPEATING PATTERNS: Which elements appear multiple times (indicating lists of items)?
4. CONTENT LINKS: Which discovered links lead to detail/content pages?
5. MISSING DATA: What does the user want that we haven't found yet? What pages should we crawl next?
6. APIs: Any intercepted JSON APIs with useful data?
7. CONFIDENCE: How confident are you that you can build a working scraper from this data? What's missing?

Be specific — reference the exact selectors, class names, and data values discovered.`;

    knowledge.analysis = await chatCompletion(modelId, [
      { role: "user", content: analysisPrompt },
    ], 0.2, 3072);

    emit({
      type: "analyzing",
      message: "Analysis complete",
      detail: knowledge.analysis.slice(0, 400) + (knowledge.analysis.length > 400 ? "…" : ""),
      data: { analysis: knowledge.analysis },
    });

    await sleep(300);

    // ── Iterative agent loop ────────────────────────────────────────────────
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const unvisitedUrls = knowledge.discoveredDetailUrls
        .filter((u) => !knowledge.visitedUrls.has(u))
        .slice(0, 5);

      const evaluatePrompt = `You are an AI agent building a web scraper. Your job is to decide: do I have enough REAL data to generate a working scraper, or do I need to gather more?

Website URL: ${websiteUrl}
User wants: ${instructions}
${isDataApi ? "Mode: DATA API" : "Mode: SCRAPER"}

=== EVERYTHING I KNOW ===
${buildKnowledgeSummary(knowledge)}

=== MY ANALYSIS ===
${knowledge.analysis.slice(0, 2000)}

SELF-CHECK — ask yourself honestly:
1. Did I find the actual DOM elements/classes that contain the user's requested data?
2. Do I have real CSS selectors with real text/href/src values — not assumptions?
3. Do I know the URL pattern for content/detail pages?
4. Can I map each data field to a specific selector I discovered?
5. Did I find the data extraction approach WITHOUT ASSUMING anything?

If YES to most → choose "generate_schema" (if no schema yet) or "generate_code" (if schema exists).
If NO → I need more data. Choose what to do next.

${knowledge.crawledPages.length === 0 ? "⚠️ I haven't crawled any pages! I MUST crawl first." : ""}
${knowledge.crawledPages.length > 0 && knowledge.crawledPages.every((p) => Object.keys(p.sampleTexts).length < 2) ? "⚠️ Pages had very little data. Try different URLs." : ""}

Respond with EXACTLY one JSON object (no markdown, no explanation):
{
  "action": "crawl_url" | "crawl_homepage" | "fetch_page" | "generate_schema" | "generate_code",
  "url": "https://..." (only for crawl_url/fetch_page),
  "reason": "why this action"
}

Actions:
- "crawl_url": Playwright-crawl a URL to discover its DOM structure and data
- "crawl_homepage": Crawl the site homepage for more content
- "fetch_page": HTTP fetch a URL
- "generate_schema": I have enough real data to define the extraction schema
- "generate_code": I have schema + real selectors, ready for final code

Already visited: ${[...knowledge.visitedUrls].join(", ")}
Unvisited discovered URLs: ${unvisitedUrls.join(", ") || "none"}`;

      const decisionRaw = await chatCompletion(modelId, [
        { role: "user", content: evaluatePrompt },
      ], 0.1, 512);

      let decision: { action: string; url?: string; reason: string };
      try {
        const jsonMatch = decisionRaw.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (!parsed || !parsed.action) throw new Error("Invalid");
        decision = parsed;
      } catch {
        if (knowledge.schema) {
          decision = { action: "generate_code", reason: "Proceeding with available data" };
        } else if (knowledge.crawledPages.length > 0) {
          decision = { action: "generate_schema", reason: "Generating schema from crawl data" };
        } else {
          decision = { action: "crawl_homepage", reason: "Need to crawl first" };
        }
      }

      emit({
        type: "thinking",
        message: `Agent: ${decision.action.replace(/_/g, " ")}`,
        detail: decision.reason,
      });

      if (decision.action === "crawl_url" && decision.url) {
        let targetUrl = decision.url;
        if (knowledge.visitedUrls.has(targetUrl)) {
          const unvisited = knowledge.discoveredDetailUrls.find((u) => !knowledge.visitedUrls.has(u));
          if (unvisited) {
            targetUrl = unvisited;
          } else {
            break;
          }
        }

        emit({
          type: "crawling",
          message: `Crawling: ${targetUrl}`,
          detail: "Discovering DOM structure and data…",
        });

        try {
          const result = await crawlSiteForDiscovery(targetUrl, [], 2);
          mergeDiscovery(knowledge, result);
          emit({
            type: "crawling",
            message: `Crawled ${result.pages.length} page(s)`,
            detail: `${result.discoveredDetailUrls.length} links · ${result.allInterceptedApis.length} APIs`,
          });
        } catch (err) {
          emit({ type: "crawling", message: "Crawl failed", detail: `${err instanceof Error ? err.message : "Unknown"}` });
        }
        await sleep(300);
        continue;
      }

      if (decision.action === "crawl_homepage") {
        const homeUrl = new URL("/", websiteUrl).href;
        emit({
          type: "crawling",
          message: `Crawling homepage: ${homeUrl}`,
          detail: "Discovering content from homepage…",
        });

        try {
          const result = await crawlSiteForDiscovery(homeUrl, [], 3);
          mergeDiscovery(knowledge, result);
          emit({
            type: "crawling",
            message: `Homepage: ${result.pages.length} page(s)`,
            detail: `${result.discoveredDetailUrls.length} links · ${result.allInterceptedApis.length} APIs`,
          });
        } catch (err) {
          emit({ type: "crawling", message: "Homepage crawl failed", detail: `${err instanceof Error ? err.message : "Unknown"}` });
        }
        await sleep(300);
        continue;
      }

      if (decision.action === "fetch_page" && decision.url) {
        emit({
          type: "fetching",
          message: `Fetching: ${decision.url}`,
          detail: "HTTP request for data…",
        });

        try {
          const fetchedPage = await tryFetchPage(decision.url);
          if (fetchedPage) {
            knowledge.fetchedPages.push(fetchedPage);
            knowledge.visitedUrls.add(decision.url);
            for (const ep of fetchedPage.probedEndpoints.filter((ep) => ep.isJsonApi)) {
              if (!knowledge.interceptedApis.some((a) => a.url === ep.url)) {
                knowledge.interceptedApis.push({ url: ep.url, sampleData: ep.sampleData, method: ep.method });
              }
            }
            emit({
              type: "browsing",
              message: `Fetched ${decision.url}`,
              detail: `Status ${fetchedPage.statusCode} · ${fetchedPage.discoveredEndpoints.length} endpoints`,
            });
          }
        } catch {}
        await sleep(300);
        continue;
      }

      if (decision.action === "generate_schema") {
        emit({
          type: "thinking",
          message: "Generating schema from real crawl data",
          detail: "Using actual discovered elements and data…",
        });

        const sampleData = buildCrawlSampleData(knowledge.crawledPages);
        const apiSample = knowledge.interceptedApis.length > 0
          ? `\n\nLive API sample:\n${knowledge.interceptedApis[0].sampleData.slice(0, 2000)}`
          : "";
        const inlineData = knowledge.fetchedPages
          .flatMap((p) => p.inlineJsonData).slice(0, 3)
          .map((d, i) => `[${i + 1}]: ${d.slice(0, 1500)}`).join("\n");

        const schemaPrompt = `Based on REAL data discovered by crawling ${websiteUrl}, generate a JSON schema for each extracted record.

User wants: ${instructions}

=== REAL DATA FROM PAGES ===
${sampleData || "No sample text data."}

=== DISCOVERED DOM ELEMENTS ===
${buildElementsReport(knowledge.crawledPages).slice(0, 3000)}

${inlineData ? `=== INLINE DATA ===\n${inlineData}` : ""}${apiSample}

=== ANALYSIS ===
${knowledge.analysis.slice(0, 1500)}

RULES:
- Schema fields MUST match actual data found on the site
- Use the real class names and element structure discovered by the bot
- Only include fields you can actually see evidence for in the crawl data
- If the user asked for specific fields, include them and note which selector maps to each

Return ONLY a valid JSON object. camelCase fields. No explanation, no markdown.`;

        const schemaRaw = await chatCompletion(modelId, [{ role: "user", content: schemaPrompt }], 0.2, 1024);

        try {
          const jsonMatch = schemaRaw.match(/\{[\s\S]*\}/);
          knowledge.schema = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch { knowledge.schema = null; }

        if (!knowledge.schema || Object.keys(knowledge.schema).length < 3) {
          knowledge.schema = { title: "", url: "", description: "", image: "", tags: [] };
        }

        emit({
          type: "analyzing",
          message: "Schema generated",
          detail: `${Object.keys(knowledge.schema).length} fields`,
          data: { schema: knowledge.schema },
        });

        if (sessionId) {
          await updateSession(sessionId, { suggested_schema: knowledge.schema });
        }
        await sleep(300);
        continue;
      }

      if (decision.action === "generate_code") {
        break;
      }

      break;
    }

    // ── Final: Generate the scraper ─────────────────────────────────────────

    if (!knowledge.schema) {
      knowledge.schema = { title: "", url: "", description: "", image: "", tags: [] };
    }
    const schema = knowledge.schema;

    emit({
      type: "refining",
      message: "Writing technical spec from real discoveries",
      detail: "Creating extraction plan using actual DOM elements found by bot crawler…",
    });

    const elementsReport = buildElementsReport(knowledge.crawledPages);
    const crawlSampleData = buildCrawlSampleData(knowledge.crawledPages);
    const detailUrlExamples = knowledge.discoveredDetailUrls.slice(0, 10).join("\n  ");

    const allLiveApis = [
      ...knowledge.interceptedApis,
      ...knowledge.fetchedPages.flatMap((p) =>
        p.probedEndpoints.filter((ep) => ep.isJsonApi).map((ep) => ({
          url: ep.url, sampleData: ep.sampleData, method: ep.method,
        }))
      ),
    ];

    const discoveredEndpointsText = knowledge.fetchedPages
      .flatMap((p) => p.discoveredEndpoints)
      .map((ep) => `[${ep.method}] ${ep.url} (${ep.source})`)
      .join("\n");

    const inlineDataText = knowledge.fetchedPages
      .flatMap((p) => p.inlineJsonData).slice(0, 5)
      .map((d, i) => `[${i + 1}]: ${d.slice(0, 2000)}`).join("\n");

    const firstHtml = knowledge.crawledPages[0]?.htmlSnippet.slice(0, 6000)
      ?? knowledge.fetchedPages[0]?.truncatedHtml.slice(0, 6000) ?? "";

    const refinePrompt = `You are a senior ${langLabel} developer. Write a technical specification for a ${isDataApi ? "data API extractor" : "web crawler"}.

A bot crawler dynamically scanned the website's DOM and discovered the actual elements, classes, and data on each page. Use these REAL discoveries — do not guess or assume selectors.

URL: ${websiteUrl}
Instructions: ${instructions}
Mode: ${isDataApi ? "DATA API (authenticated)" : "SCRAPER (public data)"}
Schema: ${JSON.stringify(schema, null, 2)}
${isCloudflareBlocked ? "⚠️ CLOUDFLARE — ALL requests through Playwright." : ""}

=== DISCOVERED DOM ELEMENTS (real classes, real data) ===
${elementsReport || "No elements discovered."}

=== CONTENT LINKS FOUND ===
${detailUrlExamples ? `  ${detailUrlExamples}` : "None."}

=== SAMPLE DATA FROM PAGES ===
${crawlSampleData || "No sample data."}

=== INTERCEPTED APIs ===
${allLiveApis.slice(0, 5).map((a) => `[${a.method}] ${a.url}\n  ${a.sampleData.slice(0, 500)}`).join("\n") || "None."}

=== ANALYSIS ===
${knowledge.analysis.slice(0, 1500)}

=== HTML ===
${firstHtml}

Write the spec:
1. Map each schema field to a SPECIFIC discovered element/class from above
2. CRAWLING is primary: navigate pages, follow links, extract per page
3. All requests through Playwright
4. Include fallbacks: homepage crawl, sitemap
5. Error handling: retry 3x, skip failures
No comments.`;

    const refinedPrompt = await chatCompletion(modelId, [
      { role: "user", content: refinePrompt },
    ], 0.3, 3072);

    emit({
      type: "refining",
      message: "Technical spec complete",
      detail: refinedPrompt.slice(0, 300) + (refinedPrompt.length > 300 ? "…" : ""),
      data: { refinedPrompt },
    });

    if (sessionId) {
      await updateSession(sessionId, { refined_prompt: refinedPrompt });
    }

    await sleep(300);

    // ── Build the scraper ───────────────────────────────────────────────────
    emit({
      type: "building",
      message: `Building ${langLabel} ${isDataApi ? "data API extractor" : "web crawler"}`,
      detail: `Generating .${ext} crawler with real discovered selectors…`,
    });

    await sleep(400);

    const baseFile = isDataApi
      ? (isTs ? generateDataApiTemplate(websiteUrl, schema, instructions, credentials)
             : generateDataApiPyTemplate(websiteUrl, schema, instructions, credentials))
      : (isTs ? generateApiFileTemplate(websiteUrl, schema, instructions)
             : generatePyFileTemplate(websiteUrl, schema, instructions));

    const TEMPLATE_PREVIEW_LINES = 60;
    const enhancePrompt = `You are a senior ${langLabel} web scraping engineer. Write a complete, production-ready ${langLabel} script that CRAWLS and extracts data using Playwright.

OUTPUT: ONLY raw ${langLabel} code. No markdown fences, no explanation, no comments. Self-contained.

CRITICAL: A bot crawler dynamically scanned the actual website DOM. It discovered every CSS class, data attribute, and element. Use the REAL class names and selectors it found — do NOT invent generic selectors.

=== TARGET ===
URL: ${websiteUrl}
Instructions: ${instructions}
Mode: ${isDataApi ? "DATA API (authenticated)" : "SCRAPER (public data)"}
Schema: ${JSON.stringify(schema, null, 2)}
${isCloudflareBlocked ? "⚠️ CLOUDFLARE — ALL requests through Playwright." : ""}

=== REAL DOM ELEMENTS DISCOVERED (USE THESE!) ===
${elementsReport || "No specific elements — use HTML below."}

=== SAMPLE DATA FROM PAGES ===
${crawlSampleData || "No sample data."}

=== CONTENT LINKS FOUND ===
${detailUrlExamples ? `  ${detailUrlExamples}` : "None."}

=== INTERCEPTED APIs ===
${allLiveApis.slice(0, 5).map((a) => `[${a.method}] ${a.url}\n  ${a.sampleData.slice(0, 500)}`).join("\n") || "None."}

=== ENDPOINTS ===
${discoveredEndpointsText || "None."}

=== INLINE DATA ===
${inlineDataText || "None."}

=== HTML FROM CRAWLED PAGES ===
${knowledge.crawledPages[0]?.htmlSnippet.slice(0, 12000) ?? knowledge.fetchedPages[0]?.truncatedHtml.slice(0, 12000) ?? ""}

=== TECHNICAL SPEC ===
${refinedPrompt.slice(0, 3000)}

${isDataApi ? `=== AUTH ===\nCredentials: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", token" : ""}${credentials?.cookies ? ", cookies" : ""}` : ""}

=== REQUIREMENTS ===
1. USE REAL SELECTORS: The bot discovered actual CSS classes and elements on the site. Use those exact class names and selectors. For each schema field, find the matching discovered element.

2. CRAWL STRATEGY:
   a. Launch Playwright, navigate to ${websiteUrl}
   b. page.on('response') to capture JSON APIs
   c. Find content links using discovered element patterns
   d. Visit each content page, extract data using discovered selectors
   e. Paginate through listings
   f. Homepage fallback if target URL is sparse
   g. Sitemap fallback

3. PER-PAGE: Use discovered selectors for each field. Intercepted API data as supplement. fillMissingFields() for gaps.

4. ERRORS: try/catch everywhere, retry 3x, skip failures, continue.

5. DATA: Generate IDs from URL hash, provider = hostname, deduplicate by URL/ID.

6. OUTPUT: JSON { total_items, scraped_at, source_url, items } → file + stdout.

7. CODE: ${isTs ? "Strict TypeScript, import playwright" : "Python type hints, playwright.sync_api"}. Class: init(), scrape(), close(). No comments.

TEMPLATE (structural guide — replace ALL generic selectors with real discovered ones):
${baseFile.split("\n").slice(0, TEMPLATE_PREVIEW_LINES).join("\n")}

Write the COMPLETE file. Use REAL discovered selectors. No generic selectors.`;

    let apiFileContent = baseFile;
    const streamParts: string[] = [];

    emit({
      type: "generating",
      message: `Streaming ${langLabel} crawler code`,
      detail: `Writing ${isDataApi ? "data API extractor" : "web crawler"} with real discovered selectors…`,
    });

    try {
      for await (const chunk of streamCompletion(modelId, [{ role: "user", content: enhancePrompt }], 0.2, 16384)) {
        streamParts.push(chunk);
        sendSSE(res, "code_chunk", { chunk });
      }
      let enhanced = streamParts.join("");
      if (enhanced.length > 500) {
        enhanced = enhanced
          .replace(/^```(?:typescript|ts|python|py|javascript|js)?\s*\n?/gm, "")
          .replace(/\n?```\s*$/gm, "")
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
      detail: `${apiFileContent.split("\n").length} lines · ${knowledge.crawledPages.length} pages crawled · ${knowledge.interceptedApis.length} APIs · Real selectors`,
      data: {
        apiFile: apiFileContent,
        schema,
        refinedPrompt,
        analysis: knowledge.analysis,
      },
    });

    sendSSE(res, "done", { sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    emit({ type: "error", message: "Agent session failed", detail: message });
    sendSSE(res, "error", { message });
  } finally {
    res.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
