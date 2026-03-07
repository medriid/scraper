import { Response } from "express";
import { chatCompletion, streamCompletion } from "./aiService.js";
import { generateApiFileTemplate, generatePyFileTemplate, generateDataApiTemplate, generateDataApiPyTemplate } from "../templates/apiTemplate.js";
import { updateSession } from "./supabaseService.js";
import { fetchAndAnalyzePage, buildPageReport } from "./pageFetcher.js";

export interface AgentStep {
  type:
    | "thinking"
    | "browsing"
    | "fetching"
    | "analyzing"
    | "discovering"
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
    // ── Step 1: Actually fetch the page ──────────────────────────────────────
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

    try {
      const page = await fetchAndAnalyzePage(websiteUrl);
      pageReport = buildPageReport(page);
      endpointCount = page.discoveredEndpoints.length;
      fetchedHtmlSnippet = page.truncatedHtml;
      discoveredEndpointsText = page.discoveredEndpoints
        .map((ep) => `[${ep.method}] ${ep.url} (source: ${ep.source})`)
        .join("\n");
      inlineDataText = page.inlineJsonData.map((d, i) => `[Block ${i + 1}]: ${d.slice(0, 2000)}`).join("\n");

      emit({
        type: "browsing",
        message: "Page fetched successfully",
        detail: `Status ${page.statusCode} · ${endpointCount} API endpoint(s) discovered · ${page.scriptSources.length} scripts · ${page.inlineJsonData.length} inline data blocks`,
        data: { endpointCount },
      });
    } catch (fetchErr) {
      const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      pageReport = `FETCH FAILED: ${fetchMsg}\nURL: ${websiteUrl}\nThe page could not be fetched directly. The scraper will need to use a browser (Playwright) to load this page.`;
      fetchedHtmlSnippet = "";

      emit({
        type: "browsing",
        message: "Direct fetch failed — site may require browser rendering",
        detail: fetchMsg,
      });
    }

    await sleep(300);

    // ── Step 2: Deep analysis with REAL page data ────────────────────────────
    emit({
      type: "thinking",
      message: "AI analyzing real page data",
      detail: "Examining fetched HTML, discovered endpoints, inline JSON, and scripts…",
    });

    const analysisPrompt = `You are an expert web scraping and API reverse-engineering engineer. You MUST base your analysis ENTIRELY on the REAL page data provided below. Do NOT guess or assume anything about the website — only describe what you can see in the actual fetched data.

Website URL: ${websiteUrl}
User Instructions: ${instructions}
${isDataApi ? `\nExtraction Mode: DATA API (authenticated user data extraction)\nUser provided credentials: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", token/API key" : ""}${credentials?.cookies ? ", cookies" : ""}` : "Extraction Mode: SCRAPER (public data extraction)"}

=== ACTUAL FETCHED PAGE DATA ===
${pageReport}
=== END PAGE DATA ===

Based ONLY on the actual data above, provide your analysis:

1. SITE TYPE: What kind of site is this based on the HTML, meta tags, and content you can see?

2. API ENDPOINTS FOUND: List every API endpoint you can see in the fetched data. For each one, describe:
   - The exact URL path
   - The HTTP method (if identifiable)
   - What data it likely returns
   - How you found it (in a script src, inline JS, fetch() call, etc.)

3. INLINE DATA: Describe any __NEXT_DATA__, ld+json, window.__STATE__, or other inline JSON/data you found. What data fields does it contain?

4. HTML STRUCTURE: Describe the actual DOM structure you see — what are the repeating elements? What CSS classes/IDs/data attributes are present that could be used for extraction?

5. AUTHENTICATION: ${isDataApi ? "Based on the discovered endpoints and form actions, describe how authentication works on this site. What auth endpoints exist? What login flow should the scraper follow?" : "Are there any auth walls visible? Does the page show public data or require login?"}

6. PAGINATION: Based on the actual links and any pagination-related URLs/endpoints you see, describe how pagination works.

7. RECOMMENDED STRATEGY: Based ONLY on what you actually found:
   - If API endpoints were discovered → describe how to call them directly
   - If inline JSON data exists → describe how to extract it
   - If neither → describe the HTML selectors to use

IMPORTANT: Be specific and reference actual URLs, selectors, and data from the fetched page. Do NOT make up endpoints or selectors that aren't in the data.`;

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

    // ── Step 3: Endpoint discovery and mapping ───────────────────────────────
    if (endpointCount > 0 || isDataApi) {
      emit({
        type: "discovering",
        message: isDataApi ? "Mapping authentication & data endpoints" : "Mapping discovered API endpoints",
        detail: `Found ${endpointCount} endpoint(s) in page source. AI is planning how to use them…`,
      });

      const endpointPrompt = `You are an API reverse-engineering expert. Based on the REAL endpoints discovered from the page source, create a detailed endpoint map.

Website URL: ${websiteUrl}
${isDataApi ? `Authentication mode: The user wants to extract per-user/authenticated data.\nCredentials available: ${credentials?.email ? "email" : ""}${credentials?.password ? ", password" : ""}${credentials?.token ? ", token" : ""}${credentials?.cookies ? ", cookies" : ""}` : "Public data mode: Extract publicly available data."}

=== DISCOVERED ENDPOINTS ===
${discoveredEndpointsText || "No endpoints discovered in HTML. Check inline data and scripts for API patterns."}

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
5. Expected response structure
6. Pagination mechanism (if applicable)

${isDataApi ? "Also describe the authentication flow:\n- Which endpoint handles login/auth?\n- What is the request body format?\n- How are session tokens returned (cookies, headers, JSON body)?\n- How to pass the token to subsequent data endpoints?" : ""}

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
    }

    // ── Step 4: Schema generation based on REAL data ─────────────────────────
    emit({
      type: "thinking",
      message: "Generating data schema from real page content",
      detail: "Inferring fields from actual data found on the page…",
    });

    const schemaPrompt = `Based on the REAL data found on this website, generate a JSON schema that describes each record the scraper will extract.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Analysis: ${analysis.slice(0, 1500)}

IMPORTANT: The schema fields MUST correspond to actual data visible in the fetched page content. Do not include fields that don't exist on this website.

${inlineDataText ? `Inline data found:\n${inlineDataText.slice(0, 2000)}\n\nUse the actual field names from this data where possible.` : ""}

Return ONLY a valid JSON object representing one extracted record. Use camelCase field names. No explanation, no markdown fences.`;

    const schemaRaw = await chatCompletion(modelId, [
      { role: "user", content: schemaPrompt },
    ], 0.2, 1024);

    let schema: Record<string, unknown> = {};
    try {
      const jsonMatch = schemaRaw.match(/\{[\s\S]*\}/);
      schema = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: "", url: "", description: "" };
    } catch {
      schema = { title: "", url: "", description: "" };
    }

    emit({
      type: "analyzing",
      message: "JSON schema generated",
      detail: `${Object.keys(schema).length} fields identified from real page data`,
      data: { schema },
    });

    if (sessionId) {
      await updateSession(sessionId, { suggested_schema: schema });
    }

    await sleep(300);

    // ── Step 5: Technical specification ───────────────────────────────────────
    emit({
      type: "refining",
      message: "Writing technical specification",
      detail: "Creating detailed extraction plan based on real findings…",
    });

    const refinePrompt = `You are a senior ${langLabel} developer specializing in web scraping and API reverse-engineering. Write a precise technical specification for a ${isDataApi ? "DATA API extraction" : "scraper"} script.

CRITICAL: Your specification MUST be based on the REAL page data and endpoints discovered below. Do NOT invent or assume any endpoints, selectors, or data structures that aren't in the actual data.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Extraction Mode: ${isDataApi ? "DATA API (authenticated/user data)" : "SCRAPER (public data)"}
Data schema: ${JSON.stringify(schema, null, 2)}

=== REAL ANALYSIS ===
${analysis.slice(0, 2000)}

=== REAL DISCOVERED ENDPOINTS ===
${discoveredEndpointsText || "None found — will need HTML/browser extraction"}

=== REAL INLINE DATA ===
${inlineDataText ? inlineDataText.slice(0, 2000) : "None found"}

=== REAL HTML SNIPPET ===
${fetchedHtmlSnippet.slice(0, 8000)}

Write a detailed spec covering:
1. EXTRACTION STRATEGY — Based on what was ACTUALLY found:
   ${endpointCount > 0 ? "- API endpoints WERE found. Describe exactly which ones to call and how." : "- No API endpoints found. Describe the HTML selectors from the actual page structure."}
   ${inlineDataText ? "- Inline JSON data WAS found. Describe how to extract it." : ""}
2. ${isDataApi ? "AUTHENTICATION FLOW — How to authenticate using the user's credentials based on the actual auth endpoints found." : "PUBLIC DATA ACCESS — How to access the public data."}
3. EXACT IMPLEMENTATION — Reference real URLs, real CSS selectors from the HTML, real JSON field names from inline data.
4. PAGINATION — Based on actual pagination patterns found in the page.
5. ERROR HANDLING — Retry logic, timeouts, missing fields.
6. OUTPUT — Structured JSON matching the schema.

Do not include comments in code snippets.`;

    const refinedPrompt = await chatCompletion(modelId, [
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

    // ── Step 6: Generate validation test snippet ─────────────────────────────
    emit({
      type: "testing",
      message: "Generating validation test",
      detail: "AI is writing a quick test to verify the extraction approach works…",
    });

    const testPrompt = `You are a senior ${langLabel} developer. Write a MINIMAL test snippet that verifies the data extraction approach will work for this website.

Website URL: ${websiteUrl}
Extraction approach from spec: ${refinedPrompt.slice(0, 2000)}
Discovered endpoints: ${discoveredEndpointsText || "None — HTML extraction"}

The test should:
${isTs ? `
1. Use fetch() (Node.js 18+ built-in) to make a single request to the most important endpoint or URL
2. Check that the response status is 200
3. Check that the response contains expected data fields
4. Print a clear PASS/FAIL result with the actual data received
5. Be a standalone script that can run with: npx tsx test.ts` : `
1. Use urllib.request to make a single request to the most important endpoint or URL
2. Check that the response status is 200
3. Check that the response contains expected data fields
4. Print a clear PASS/FAIL result with the actual data received
5. Be a standalone script that can run with: python test.py`}

${isDataApi && credentials ? `Include authentication using the provided credentials format.` : ""}

RULES:
- Do NOT use Playwright or any browser — just HTTP requests
- Do NOT include any comments
- Return ONLY raw ${langLabel} code, no markdown fences
- Keep it under 60 lines
- Use REAL URLs from the discovered endpoints or the website URL itself`;

    const testSnippet = await chatCompletion(modelId, [
      { role: "user", content: testPrompt },
    ], 0.2, 2048);

    const cleanTest = testSnippet.replace(/^```(?:typescript|ts|python|py)?\n?/m, "").replace(/\n?```$/m, "");

    emit({
      type: "validating",
      message: "Validation test generated",
      detail: `${cleanTest.split("\n").length} lines — this test verifies the extraction approach before building the full scraper`,
      data: { testResult: cleanTest },
    });

    await sleep(300);

    // ── Step 7: Build the full scraper ───────────────────────────────────────
    emit({
      type: "building",
      message: `Building ${langLabel} ${isDataApi ? "data API extractor" : "scraper"}`,
      detail: `Generating production-ready .${ext} file based on real page analysis…`,
    });

    await sleep(400);

    const baseFile = isDataApi
      ? (isTs
        ? generateDataApiTemplate(websiteUrl, schema, instructions, credentials)
        : generateDataApiPyTemplate(websiteUrl, schema, instructions, credentials))
      : (isTs
        ? generateApiFileTemplate(websiteUrl, schema, instructions)
        : generatePyFileTemplate(websiteUrl, schema, instructions));

    const enhancePrompt = `You are a senior ${langLabel} developer. Write a complete, production-ready ${langLabel} script that extracts data from the target website.

CRITICAL RULES:
- Do NOT include any comments in the code. Zero comments, zero docstrings.
- Do NOT wrap the output in markdown fences. Return ONLY raw source code.
- The script must do all fetching itself — the user just runs it.
- EVERY URL, selector, endpoint, and field name MUST come from the REAL page data below. Do NOT invent or assume anything.

MODE: ${isDataApi ? "DATA API — Authenticated user data extraction" : "SCRAPER — Public data extraction"}

STRATEGY (based on what was ACTUALLY found on the page):
${endpointCount > 0 ? `1. API ENDPOINTS FOUND (${endpointCount}): Call these directly using ${isTs ? "fetch()" : "httpx/requests"}. This is the primary approach.
Discovered endpoints:
${discoveredEndpointsText}` : "1. NO API ENDPOINTS FOUND: Use Playwright for browser-based extraction."}
${inlineDataText ? `\n2. INLINE DATA FOUND: The page contains embedded JSON data that can be extracted:\n${inlineDataText.slice(0, 2000)}` : ""}
${!endpointCount && !inlineDataText ? `\n2. HTML EXTRACTION: Use the actual HTML structure below for selectors.\n` : ""}

REAL PAGE DATA:
- URL: ${websiteUrl}
- Title: ${fetchedHtmlSnippet ? fetchedHtmlSnippet.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Unknown" : "Unknown"}
- Data schema: ${JSON.stringify(schema, null, 2)}

REAL HTML (first 10000 chars):
${fetchedHtmlSnippet.slice(0, 10000)}

TECHNICAL SPECIFICATION:
${refinedPrompt.slice(0, 3000)}

${isDataApi ? `AUTHENTICATION:
The user will provide credentials. The script should:
1. Authenticate using the site's actual auth endpoint(s) found above
2. Store the session/token
3. Use it for subsequent data requests
${credentials?.email ? `User email format available` : ""}${credentials?.token ? `, API token/key available` : ""}${credentials?.cookies ? `, Session cookies available` : ""}
` : ""}

TEST VALIDATION (the approach was tested with this snippet):
${cleanTest.slice(0, 1500)}

BASE TEMPLATE TO ENHANCE:
\`\`\`${isTs ? "typescript" : "python"}
${baseFile}
\`\`\`

Requirements:
1. Use REAL selectors, endpoints, and field names from the actual page data — not generic guesses
2. Implement the correct strategy based on what was actually found (API-first if endpoints exist)
3. Implement proper pagination based on real pagination patterns found
4. Add retry logic with exponential backoff
5. Add configurable delay between requests (default 1-2 seconds)
6. ${isTs ? "Add full TypeScript types matching the schema" : "Add dataclass/TypedDict matching the schema"}
7. Output extracted data as formatted JSON to stdout
8. ABSOLUTELY NO COMMENTS anywhere in the code

Return ONLY the complete ${langLabel} source code.`;

    let apiFileContent = baseFile;
    const streamParts: string[] = [];

    emit({
      type: "generating",
      message: `Streaming ${langLabel} code`,
      detail: `AI writing your custom ${isDataApi ? "data API extractor" : "scraper"} based on real page analysis…`,
    });

    try {
      for await (const chunk of streamCompletion(
        modelId,
        [{ role: "user", content: enhancePrompt }],
        0.2,
        8192
      )) {
        streamParts.push(chunk);
        sendSSE(res, "code_chunk", { chunk });
      }
      const enhanced = streamParts.join("");
      if (enhanced.length > 500) {
        apiFileContent = enhanced.replace(/^```(?:typescript|ts|python|py)?\n?/m, "").replace(/\n?```$/m, "");
      }
    } catch (err) {
      console.warn("Stream failed, using base template:", err);
    }

    if (sessionId) {
      await updateSession(sessionId, { generated_api_file: apiFileContent });
    }

    emit({
      type: "complete",
      message: `${isDataApi ? "Data API extractor" : "Scraper"} file ready`,
      detail: `${apiFileContent.split("\n").length} lines of ${langLabel} generated · Based on real page analysis · ${endpointCount} API endpoint(s) utilized`,
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
