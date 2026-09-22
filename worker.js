/**
 * Cloudflare Worker with two jobs, both on Workers AI (no extra accounts,
 * no extra API keys):
 *
 * 1. IMAGE mode — reads a visitor-headcount screenshot directly with a
 *    vision-language model, skipping any separate OCR step (OCR-then-
 *    clean-up used to compound errors: OCR garbled dense grid tables,
 *    then the text model had no way to recover from already-corrupted
 *    input). Uses Llama 4 Scout, Meta's current natively-multimodal
 *    model — a real step up in image/table reading accuracy over the
 *    older Llama 3.2 11B Vision model this used to run.
 *
 * 2. TEXT-REPAIR mode — a fallback for messy/inconsistent pasted text.
 *    The app's regex parser is strict on purpose (so normal messages
 *    parse instantly, for free, with zero AI involvement). When that
 *    strict parser can't make sense of something — a missing dash in an
 *    hour header, a typo, an inconsistent format — instead of just
 *    erroring out, the app sends the raw text here. The model's ONLY
 *    job is to *reformat* the text into the exact same strict format the
 *    app already understands (fixing separators, hour formats, spacing)
 *    — never to read numbers off a table it can't see, invent a number,
 *    or "helpfully" correct a headcount. The app then re-runs its own
 *    strict, deterministic parser on the model's output, so the actual
 *    numbers in the final table always come from the regex parser
 *    reading the model's reformatted text, never from the model's own
 *    judgment about what a number "should" be.
 *
 * Deploy:
 *   wrangler.toml needs:
 *     [ai]
 *     binding = "AI"
 *
 *   wrangler deploy
 */

const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const TEXT_REPAIR_MODEL = "@cf/meta/llama-3.3-70b-instruct";

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

      const { image, rawText, canonicalLocations } = body;
      if (!Array.isArray(canonicalLocations)) {
        return json({ error: "Expected canonicalLocations: string[], plus either image or rawText" }, 400);
      }

      if (image) {
        return await handleImage(env, image, canonicalLocations);
      }
      if (rawText) {
        return await handleTextRepair(env, rawText, canonicalLocations);
      }
      return json({ error: "Expected either { image } or { rawText } in the request body" }, 400);
    } catch (err) {
      // Any failure still returns real JSON with CORS headers instead of
      // crashing — a crash with no CORS headers shows up client-side as a
      // generic "Failed to fetch" with no useful detail.
      return json({ error: "Worker error: " + (err && err.message ? err.message : String(err)) }, 500);
    }
  },
};

async function handleImage(env, image, canonicalLocations) {
  const systemPrompt = `You read visitor-headcount screenshots of Excel tables.
Locations are rows, hours (00:00-01:00 through 23:00-00:00) are columns,
and there is usually a Total column at the far right of each row. Some
tables are only partially filled in during the day — later hour columns
are genuinely blank because that data hasn't been reported yet, not
because it's zero.

CRITICAL — hour column alignment: before extracting any numbers, first
read and mentally list every hour column header left to right exactly as
printed (e.g. 00:00-01:00, 01:00-02:00, 02:00-03:00, ...). It is very easy
to drift by one column partway through a wide table — double check each
number you extract is under the header you think it's under, not the
column next to it. This is the single most common mistake, so be
deliberate and re-verify column alignment periodically as you scan across
the row.

Rules — follow strictly, do not deviate:
1. Only use these exact location names, nothing else: ${canonicalLocations.join(", ")}.
2. If a row's label in the image doesn't match one of those names, keep the label exactly as written in the image (do not rename or guess a match) so the app can flag it for the user.
3. Output one "Time: HHMMhrs-HHMMhrs" header line per hour column that has at least one visible number in it, then one "LocationName - Number" line per location that has an actual visible number for that hour.
4. A BLANK or empty cell in the image means "not reported yet" — do NOT output a line for it, and NEVER write 0 or any other number for a cell you cannot actually see a digit in. Omitting the line entirely is correct; guessing a number is not.
5. If a number is genuinely present but the digits are ambiguous/unreadable, output "?" instead of guessing a digit.
6. Never invent a location, hour column, or number that is not actually visible in the image.
7. After all the hourly lines, if the image has a Total column on the right showing each location's row total, output one line per location in the exact format "TOTAL - LocationName - Number" using that visible Total column value. This is used to double-check your hourly reading, so read it as carefully as any other number, from the actual Total column, not calculated by you.
8. If there is no visible Total column in the image, skip step 7 entirely — do not calculate or invent a total.
9. Output plain text only — no commentary, no markdown, no explanations, no summary, no description of the image.`;

  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: "Read the visitor-headcount table in this image and output it in the required format." },
        { type: "image_url", image_url: { url: image } },
      ],
    },
  ];

  const response = await env.AI.run(VISION_MODEL, {
    messages,
    max_tokens: 2048,
  });

  const cleaned = response?.response || "";
  return json({ cleaned }, 200);
}

async function handleTextRepair(env, rawText, canonicalLocations) {
  const systemPrompt = `You clean up messy, informally-typed WhatsApp headcount reports so a
strict, deterministic parser downstream can read them. You are a
REFORMATTER, not a data source — the numbers in your output must be
EXACTLY the numbers already present in the input text, character for
character. You are fixing structure and spacing, not headcounts.

Known location names for this report (use these exact spellings when a
line clearly refers to one of them, even if typed differently):
${canonicalLocations.join(", ")}

Rules — follow strictly, do not deviate:
1. Every hour header becomes its own line in EXACTLY this format:
   "Time: HHMMhrs-HHMMhrs" (24-hour clock, four digits each side, a
   single dash, no spaces around the dash). Use common sense to fix
   whatever the original formatting was: a missing dash or separator, an
   inconsistent dash character, "am"/"pm" times (convert to 24-hour —
   e.g. "8:00 PM to 9:00 PM" becomes "Time: 2000hrs-2100hrs"), hour
   ranges spelled out in words, stray punctuation or asterisks around
   the header, or minor typos in the word "Time"/"Location". "2400" and
   "0000" both mean midnight — keep whichever the original used.
2. Directly under each hour header, output one line per location in
   EXACTLY this format: "LocationName - Number", one location per line.
   Fix inconsistent bullets/punctuation/spacing, but the location name
   and the number must reflect exactly what the input said for that
   location under that hour.
3. If a location name in the input clearly matches one of the known
   names above (allowing for typos, spacing, capitalization, abbreviations),
   rewrite it to the exact known spelling. If it does NOT confidently
   match any known name, leave it exactly as originally written — do
   NOT invent or guess a mapping, so the app can flag it for a human.
4. NEVER invent, guess, correct, round, or "fix" a number. If a number
   is genuinely ambiguous or unreadable in the input, output "?" in its
   place instead of guessing. Every number you output must trace back to
   an actual digit sequence in the input.
5. If a block has a stated total (e.g. "Grand Total: 34", "Total = 34"),
   keep it as its own line directly after that hour's location lines, in
   the exact format "Grand Total: N".
6. Do not add, remove, merge, or reorder any actual data. Do not
   summarize, explain, or comment on the input. Do not invent an hour,
   location, or line that was not present in the input.
7. Output plain text only — no markdown, no commentary, no code fences,
   nothing before the first "Time:" line or after the last data line.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Reformat this report:\n\n${rawText}` },
  ];

  const response = await env.AI.run(TEXT_REPAIR_MODEL, {
    messages,
    max_tokens: 3000,
  });

  const cleaned = response?.response || "";
  return json({ cleaned }, 200);
}

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
