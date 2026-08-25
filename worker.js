/**
 * Cloudflare Worker — reads a visitor-headcount screenshot directly using
 * a vision model, skipping OCR entirely. OCR-then-clean-up was compounding
 * errors: OCR garbled dense grid tables, then the text model had no way to
 * recover from already-corrupted input. Reading the image directly avoids
 * that whole failure mode.
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
    try {
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

      const { image, canonicalLocations } = body;
      if (!image || !Array.isArray(canonicalLocations)) {
        return json({ error: "Expected { image: base64 data URL, canonicalLocations: string[] }" }, 400);
      }

      const systemPrompt = `You read visitor-headcount screenshots of Excel tables.
Locations are rows, hours (00:00-01:00 through 23:00-00:00) are columns,
and there may be a Total column per row — ignore Total columns entirely.
Some tables are only partially filled in during the day — later hour
columns are genuinely blank because that data hasn't been reported yet,
not because it's zero.

Rules — follow strictly, do not deviate:
1. Only use these exact location names, nothing else: ${canonicalLocations.join(", ")}.
2. If a row's label in the image doesn't match one of those names, keep the label exactly as written in the image (do not rename or guess a match) so the app can flag it for the user.
3. Output one "Time: HHMMhrs-HHMMhrs" header line per hour column that has at least one visible number in it, then one "LocationName - Number" line per location that has an actual visible number for that hour.
4. A BLANK or empty cell in the image means "not reported yet" — do NOT output a line for it, and NEVER write 0 or any other number for a cell you cannot actually see a digit in. Omitting the line entirely is correct; guessing a number is not.
5. If a number is genuinely present but the digits are ambiguous/unreadable, output "?" instead of guessing a digit.
6. Never invent a location, hour column, or number that is not actually visible in the image.
7. Ignore Total/subtotal columns and rows completely — never output a line for them.
8. Output plain text only — no commentary, no markdown, no explanations, no summary, no description of the image.`;

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Read the visitor-headcount table in this image and output it in the required format." },
      ];

      const response = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
        messages,
        image,
        max_tokens: 2048,
      });

      const cleaned = response?.response || "";
      return json({ cleaned }, 200);
    } catch (err) {
      // Any failure still returns real JSON with CORS headers instead of
      // crashing — a crash with no CORS headers shows up client-side as a
      // generic "Failed to fetch" with no useful detail.
      return json({ error: "Worker error: " + (err && err.message ? err.message : String(err)) }, 500);
    }
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
