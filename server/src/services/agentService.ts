import { Response } from "express";
import { chatCompletion, streamCompletion } from "./aiService.js";
import { generateApiFileTemplate } from "../templates/apiTemplate.js";
import { updateSession } from "./supabaseService.js";

export interface AgentStep {
  type:
    | "thinking"
    | "browsing"
    | "analyzing"
    | "generating"
    | "refining"
    | "building"
    | "complete"
    | "error";
  message: string;
  detail?: string;
  data?: unknown;
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
  res: Response
): Promise<void> {
  const steps: AgentStep[] = [];

  const emit = (step: AgentStep) => {
    steps.push(step);
    sendSSE(res, "step", step);
  };

  try {
    // ── Step 1: Analyse the website ──────────────────────────────────────────
    emit({
      type: "browsing",
      message: "Analysing target website",
      detail: `Fetching structure for ${websiteUrl}…`,
    });

    await sleep(400);

    const analysisPrompt = `You are an expert web scraping analyst. Analyse this website and instructions:

Website URL: ${websiteUrl}
Instructions: ${instructions}

Your task:
1. Identify what type of data this website likely contains (e-commerce, news, directory, etc.)
2. Suggest the best CSS selectors and page structure based on common patterns for this type of site
3. Identify any anti-scraping measures to watch for (rate limiting, JS rendering, CAPTCHAs, etc.)
4. Suggest optimal scraping strategy (pagination, infinite scroll, API endpoints, etc.)

Be specific and technical. Format as structured analysis.`;

    emit({
      type: "thinking",
      message: "AI analysing website structure",
      detail: "Processing website type and data patterns…",
    });

    const analysis = await chatCompletion(modelId, [
      { role: "user", content: analysisPrompt },
    ], 0.3, 2048);

    emit({
      type: "analyzing",
      message: "Website analysis complete",
      detail: analysis.slice(0, 300) + (analysis.length > 300 ? "…" : ""),
      data: { analysis },
    });

    await sleep(300);

    // ── Step 2: Generate JSON Schema ─────────────────────────────────────────
    emit({
      type: "thinking",
      message: "Generating suggested JSON schema",
      detail: "Inferring data structure from instructions and website type…",
    });

    const schemaPrompt = `Based on this website and instructions, generate a JSON schema for the scraped data.

Website URL: ${websiteUrl}
Instructions: ${instructions}
Analysis: ${analysis.slice(0, 500)}

Return ONLY a valid JSON object (no markdown, no explanation) representing a single scraped record.
Use realistic field names (camelCase). Include all relevant fields.
Example fields: title, url, price, description, imageUrl, date, author, rating, etc.
Choose fields that are actually relevant to this specific website.`;

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
      detail: `${Object.keys(schema).length} fields identified`,
      data: { schema },
    });

    if (sessionId) {
      await updateSession(sessionId, { suggested_schema: schema });
    }

    await sleep(300);

    // ── Step 3: Refine the prompt ─────────────────────────────────────────────
    emit({
      type: "refining",
      message: "Refining scraping prompt",
      detail: "Optimising instructions for maximum accuracy…",
    });

    const refinePrompt = `You are an expert prompt engineer for web scraping. Refine this scraping request into a precise, technical specification.

Original URL: ${websiteUrl}
Original instructions: ${instructions}
Identified schema: ${JSON.stringify(schema, null, 2)}

Create a refined, detailed prompt that:
1. Specifies exact data to extract with field-by-field detail
2. Handles edge cases (missing data, dynamic content, pagination)
3. Includes error handling requirements
4. Specifies output format and validation rules
5. Notes rate limiting and ethical scraping requirements

Write the refined prompt as a clear technical specification (not JSON).`;

    const refinedPrompt = await chatCompletion(modelId, [
      { role: "user", content: refinePrompt },
    ], 0.4, 2048);

    emit({
      type: "refining",
      message: "Prompt refinement complete",
      detail: refinedPrompt.slice(0, 300) + (refinedPrompt.length > 300 ? "…" : ""),
      data: { refinedPrompt },
    });

    if (sessionId) {
      await updateSession(sessionId, { refined_prompt: refinedPrompt });
    }

    await sleep(300);

    // ── Step 4: Generate the TypeScript API file ──────────────────────────────
    emit({
      type: "building",
      message: "Building TypeScript scraper API",
      detail: "Generating production-ready .ts file…",
    });

    await sleep(500);

    const baseFile = generateApiFileTemplate(websiteUrl, schema, instructions, refinedPrompt);

    // Ask AI to enhance and customise the file
    const enhancePrompt = `You are an expert TypeScript developer specialising in web scraping with Playwright.

Enhance this base scraper TypeScript file for the specific website and requirements:

Website: ${websiteUrl}
Instructions: ${instructions}
Schema: ${JSON.stringify(schema, null, 2)}

Base file:
\`\`\`typescript
${baseFile}
\`\`\`

Return the COMPLETE enhanced TypeScript file. Improvements to make:
1. Add specific CSS selectors for this website's likely HTML structure
2. Handle pagination if relevant (multiple pages, infinite scroll)
3. Add proper error handling and retry logic with exponential backoff
4. Add rate limiting (delay between requests)
5. Add data validation and cleaning
6. Add TypeScript types that match the schema exactly
7. Keep all existing comments and structure, just enhance them

Return ONLY the TypeScript code, no markdown fences.`;

    let apiFileContent = baseFile;
    const streamParts: string[] = [];

    emit({
      type: "generating",
      message: "Streaming TypeScript code",
      detail: "AI writing your custom scraper…",
    });

    try {
      for await (const chunk of streamCompletion(
        modelId,
        [{ role: "user", content: enhancePrompt }],
        0.2,
        4096
      )) {
        streamParts.push(chunk);
        sendSSE(res, "code_chunk", { chunk });
      }
      const enhanced = streamParts.join("");
      if (enhanced.length > 500) {
        // Strip markdown fences if AI added them
        apiFileContent = enhanced.replace(/^```(?:typescript|ts)?\n?/m, "").replace(/\n?```$/m, "");
      }
    } catch (err) {
      // Fall back to base template if streaming fails
      console.warn("Stream failed, using base template:", err);
    }

    if (sessionId) {
      await updateSession(sessionId, { generated_api_file: apiFileContent });
    }

    emit({
      type: "complete",
      message: "Scraper API file ready",
      detail: `${apiFileContent.split("\n").length} lines of TypeScript generated`,
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
