/**
 * Cloudflare Worker — OCR cleanup step.
 *
 * The frontend never guesses numbers itself here — this Worker's only job
 * is to take messy raw OCR text (misread spacing, broken table lines, stray
 * characters) and reformat it into clean "Location - Number" lines with a
 * "Time: Xhrs-Yhrs" header per hour block, using the SAME canonical location
 * names the frontend already knows about. It does NOT invent, guess, or fill
 * in missing numbers — if a number is unreadable, it leaves it as "?" so the
 * frontend's strict parser flags it for you instead of silently being wrong.
 *
 * Deploy:
 *   wrangler.toml needs:
 *     [ai]
 *     binding = "AI"
 *
 *   wrangler deploy
 */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { raw, canonicalLocations } = body;
    if (!raw || !Array.isArray(canonicalLocations)) {
      return json({ error: "Expected { raw: string, canonicalLocations: string[] }" }, 400);
    }

    const systemPrompt = `You clean up messy OCR text from a visitor-headcount screenshot.
The screenshots are Excel tables. Locations are rows, hours (00:00-01:00
through 23:00-00:00) are columns, and the last column is a Total per row.
Some tables are only partially filled in during the day — later hour
columns are genuinely blank because that data hasn't been reported yet,
not because it's zero.

Rules — follow strictly, do not deviate:
1. Only use these exact location names, nothing else: ${canonicalLocations.join(", ")}.
2. If OCR text refers to a location NOT in that list, keep the original text as-is (do not rename it) so the app can flag it.
3. Output one "Time: HHMMhrs-HHMMhrs" header line per hour block, then one "LocationName - Number" line per location that has an actual visible number for that hour.
4. A BLANK cell in the source table means "not reported yet" — do NOT output a line for it, and NEVER write 0 or any other number for a cell you cannot actually see a digit in. Omitting the line entirely is correct; guessing a number is not.
5. If a number is genuinely present but the digits are ambiguous/unreadable, output "?" instead of guessing a digit.
6. Never invent a location, hour, or number that is not actually visible in the input.
7. Do not increase or decrease the number of hour columns beyond what's visible in the source — if only 6 columns of a 24-column table are filled, output only those 6 hour blocks.
8. Output plain text only — no commentary, no markdown, no explanations, no summary at the end.`;

    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: raw },
      ],
      temperature: 0,
      max_tokens: 2048,
    });

    const cleaned = response?.response || "";
    return json({ cleaned }, 200);
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
