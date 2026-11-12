# Tally

AI rent roll for owners who live in spreadsheets, PDFs and paper ledgers.

Tally reads whatever an owner of 5–500 units already has — property-management exports, Excel/Google Sheets, bank and payment-app statements, lease PDFs, photos of handwritten ledgers — and builds one clean, verified rent roll. It explains the numbers in plain English, ranks specific ways to earn more (each with a dollar figure), and manages delinquencies, including letters the owner reviews before anything goes out.

Live demo: https://tally-rent-roll.vercel.app (loads the fictional 48-unit "Maple Court").

> **Not legal or financial advice.** See [What is and isn't legal advice](#what-is-and-isnt-legal-advice).

## Core principle: AI reads and writes words; code does the math

- AI is used **only** to extract data from messy sources, route a question to a query function, and word explanations and friendly letters.
- **Every number** — totals, occupancy, loss-to-lease, aging, dollar impact, payment plans — is computed by deterministic, unit-tested TypeScript in `src/lib/metrics`, `src/lib/recs` and `src/lib/delinquency`.
- Generated text is checked: if a letter contains a dollar figure that isn't one of the computed facts, the text is discarded and the template is used (`figuresAreGrounded` in `src/lib/ai/provider.ts`).
- Every extracted value keeps provenance (source file, row / page / image region, confidence). Low-confidence values go to a review queue. Sources that disagree raise a conflict that is never auto-resolved.

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000, choose **Add your data**, then **Try it with sample files** (or drop in your own). No API key or database setup is needed: SQLite is created at `data/tally.db` and uploads are stored in `data/uploads`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app |
| `npm test` | Unit tests + end-to-end pipeline test (98 tests) |
| `npm run build` | Production build |
| `npm run sample:generate` | Regenerate the Maple Court sample files |
| `npx drizzle-kit generate` | Create a migration after changing `src/lib/db/schema.ts` |

## Environment variables

All optional.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Use OpenAI for extraction and wording |
| `XAI_API_KEY` | Use xAI instead (OpenAI-compatible API) |
| `TALLY_AI_MODEL` | Model name (default `gpt-4o` / `grok-4`) |
| `OPENAI_BASE_URL`, `XAI_BASE_URL` | Override the API base URL |
| `TALLY_AI_PROVIDER=demo` | Force the demo provider even if a key is set |
| `TALLY_DATA_DIR` | Where the database and uploads live (default `./data`) |
| `TALLY_DB_PATH` | Database file (default `<data dir>/tally.db`) |
| `TALLY_DEMO_SEED=1` | Load Maple Court automatically on first request |

**Without a key** the demo provider runs: spreadsheets, CSVs and bank statements are parsed directly; plainly worded leases are abstracted by pattern matching; the two bundled ledger scans return recorded fixtures; letters use the built-in templates; Ask Tally routes questions by keyword. New handwriting and unusually worded leases need a real provider.

## How it works

1. **Ingest** (`src/lib/ingest`) — each file is detected and routed: rent-roll export or spreadsheet → column mapping (auto-suggested, editable, remembered by header signature); bank / payment-app export → deposits; lease PDF → lease abstract; image → vision extraction with per-cell confidence and the image region of each line. Rows are *staged*, not yet trusted.
2. **Review** — impossible dates, duplicate rows, hard-to-read handwriting, conflicts and unmatched deposits are listed side by side with their source. Accept, fix or ignore.
3. **Merge & reconcile** (`src/lib/reconcile`) — entity resolution ("J. Smith" = "John Smith"), field-by-field merge with conflict detection, deposit matching on payer name, unit in the memo and amount (every match records its reasons; weak or ambiguous evidence stays unmatched), and de-duplication of the same payment seen in two sources.
4. **Analyze** (`src/lib/analysis.ts`) — one function runs every metric; screens, exports, recommendations, letters and Ask Tally all read from it.

## Data model

Drizzle schema in `src/lib/db/schema.ts`. Money is integer cents; dates are `YYYY-MM-DD`.

```
Property ─┬─ Unit ── Lease ─┬─ Charges
          │                 └─ Payments (leaseId null = unmatched deposit)
          ├─ Notices        every approved letter: type, who approved, how/when delivered
          ├─ Conflicts      sources that disagree (+ Resolutions: the owner's decisions)
          ├─ Promises       promises to pay
          └─ Comps          market comps the owner enters

SourceFile ── StagedRow     extracted records with per-field { value, raw, confidence } and a locator
FieldProvenance             per field: source file, staged row, confidence, verified
ColumnMappings              remembered column mappings
```

- **Property**: name, address, city, state, unit count, `caresCovered` (yes/no/unknown), `rentControl` + cap, max increase, pricing-suggestions switch, late-fee policy, `asOf`, settings JSON (ladder, benchmark ranges, assistance text).
- **Unit**: number, type, beds/baths, sqft, status (occupied / vacant / notice / down / model / employee), market rent, vacant-since.
- **Lease**: residents, start, end, month-to-month flag, contract rent, recurring charges (pet / parking / storage / utilities, each `billed` or not), concessions with burn-off dates, deposit held and required, subsidy (tenant vs HAP portion, billed and per lease), late-fee authorization, MTM premium.
- Every canonical row has `source_id` + `confidence`; `field_provenance` holds the same pair per field.

## Metrics

All in `src/lib/metrics`, each with a hand-computed test fixture (`tests/fixtures/small.ts`): unit mix, physical occupancy, economic occupancy (collected ÷ gross potential rent), gross potential rent, vacancy loss, loss-to-lease, concessions, the GPR-to-collected waterfall, delinquency aging (current, 1–30, 31–60, 61–90, 90+), collection rate and trend, expiration schedule (flags months over 10% of units), month-to-month count, renewals due in 30/60/90 days, other income per occupied unit, deposits held vs required, average days vacant, and benchmark flags.

## Recommendations and fair housing

`src/lib/recs/engine.ts` is a rules engine: renewals below market, unbilled lease charges, concession burn-offs, month-to-month residents, long vacancies, expiration clustering, inconsistent late fees, deposit shortfalls and subsidy mismatches. Each item shows its arithmetic.

- The engine's input is a strict whitelist (`RecInputSchema`): lease terms, unit facts and payment timing. A resident name, age or any other attribute makes it throw; `engine.test.ts` enforces this.
- Market rent comes only from the owner's own data. Tally never uses or simulates competitors' non-public data.
- Suggested rents respect the owner's max increase and any rent-control cap, and never exceed market. A per-property switch turns pricing suggestions off where local law restricts algorithmic rent-setting.

## Adding a state's notice templates

Formal notices (pay-or-quit, notice to vacate) are never written by AI. They come from template files merged with ledger data.

1. Create `templates/notices/<STATE>/<type>.txt`, where `<STATE>` is the two-letter code and `<type>` is `pay_or_quit` or `notice_to_vacate`. Keep the "SAMPLE — have your attorney review before use." header until your attorney has approved the text.
2. Use these placeholders: `{{title}}`, `{{date}}`, `{{residents}}`, `{{unit}}`, `{{property_name}}`, `{{property_address}}`, `{{amount}}`, `{{itemized}}`, `{{days}}`, `{{owner_name}}`, `{{assistance_note}}`.
3. Add the notice period to `config/notice-periods.json`:
   ```json
   "states": { "OH": { "pay_or_quit": { "days": 3, "title": "Notice to Leave the Premises" } } }
   ```
   Notice periods live only in this file — not in code and not in any AI prompt.
4. Set the property's state in Settings. A state with its own templates uses only those; otherwise the `DEFAULT` samples are used.

Guards that always apply (`src/lib/delinquency/notices.ts`, tested):

- If the property's CARES status is **yes or unknown**, any notice for nonpayment shorter than 30 days is blocked and 30 days is used, with a one-sentence explanation. If unknown, the owner is asked to confirm.
- Late fees are left out of a formal notice unless a lease on file authorizes them.
- Every letter goes preview → edit → approve → export PDF / copy text. Nothing is sent automatically. Approval and delivery are logged with who and when.

## What is and isn't legal advice

Tally is a bookkeeping and drafting tool. **Nothing in it is legal or financial advice.**

- The notice templates and the notice periods in `config/notice-periods.json` are **samples** for demonstration. They have not been reviewed by an attorney and may be wrong or out of date for your state, city, lease or housing program. Have your attorney review every formal notice before use.
- The CARES Act guard is a conservative safety check, not a determination that your property is or isn't covered.
- Rent-control caps, late-fee limits and fair-housing obligations vary by place. Tally applies the limits you enter; it does not know your local law.
- Benchmark ranges are Tally's starting rules of thumb, not a market survey. Change them in Settings.
- Recommendations are arithmetic on your own data, not a prediction that a resident will accept a renewal or that a unit will lease at market rent.

## Sample data

`sample-data/maple-court` is a fictional 48-unit property rendered from `scripts/sample/truth.ts` and then made deliberately messy: a rent-roll CSV with three errors (an impossible date, a duplicated unit, a rent that disagrees with the lease), a landlord's tracker spreadsheet with different column names and abbreviated names, a bank statement with 46 deposits (2 unmatchable, 1 partial), 5 lease PDFs (one with an unbilled $35 pet fee, one month-to-month), and 2 synthetic handwritten ledger scans. All names and addresses are fictional.

The end-to-end test (`tests/e2e/pipeline.test.ts`) imports these files and checks the results against hand-computed figures: $56,265 collected of $67,380 possible, 4 delinquent residents owing $10,800 across four aging buckets, 6 below-market renewals due in 90 days, the unbilled pet fee, the June expiration cluster, the rent conflict, and letter and rent-roll PDFs.

## Choices made along the way

- **"Today" is the data's date.** All date math uses the property's as-of date (the latest dated activity in the imported files), so the numbers match the documents rather than the wall clock.
- **Per-field provenance** is stored in a `field_provenance` table rather than two extra columns per field; rows also carry `source_id` and `confidence`.
- **Conflicts keep a working value.** Until the owner decides, Tally uses the billing system's value, marks it unverified, and shows which value is in use.
- **Payments apply oldest charge first**, separately for the tenant's share and the voucher's share. Delinquency counts only what the tenant owes.
- **"Collected" in the waterfall** is rent paid against this month's rent charges, so the waterfall always reconciles to the cent.
- **Hero revenue figure** counts new revenue only. Scheduled concession step-ups and one-time deposit amounts are shown but not added in.
- **Late-fee impact** is missed fees over the last three months, averaged per month, excluding leases known to have no late-fee clause.
- **Renewal suggestions** round down to a whole $5 so a cap is never exceeded.
- **Next.js 16** with cache components turned off; every page renders on request because the data is local SQLite.
- **PDF text** is read with `unpdf` (a serverless build of pdf.js). Image pre-processing uses `sharp` (auto-orient, contrast normalize, resize); true deskew is not implemented.
- **shadcn/ui** components are hand-written in `src/components/ui` in the shadcn style on Radix primitives rather than generated by the CLI.
- **Rent-roll tables inside PDFs** are detected but not parsed; export CSV or Excel instead.
- **Ask Tally** routes each question to one tested query function and cites rows; it does not hold a multi-turn conversation.
- **Hosted demo**: serverless hosts only allow writes to a temporary folder, so the Vercel deployment re-loads Maple Court on each cold start and changes made there don't persist. Run locally for real use.
- **Single owner, single active property.** The schema supports several properties; the screens show the one with a built rent roll.

## Stack

Next.js (App Router) · TypeScript · Tailwind · Radix (shadcn-style components) · lucide-react · Recharts · SQLite via Drizzle · papaparse · SheetJS · unpdf · sharp · @react-pdf/renderer · Vitest.
