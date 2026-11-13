# Contributing

Tally is free and open source (MIT). Contributions are welcome.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit + end-to-end pipeline tests
```

## Ground rules

1. **Code does the math.** Any number shown to an owner must come from a deterministic function with a test. AI may read documents and write words; it must never compute or supply a figure.
2. **Nothing is silently guessed.** Extracted values carry a source and a confidence. Low confidence goes to the review queue; disagreeing sources become a conflict the owner settles.
3. **Fair housing.** The recommendation engine's input is a strict whitelist of lease, unit and payment-timing fields. Don't widen it with anything about who a resident is. The test in `src/lib/recs/engine.test.ts` must keep passing.
4. **Formal notices come from templates**, never from AI, and notice periods live in `config/notice-periods.json`.
5. **Plain English.** The reader is an owner, not an analyst. Jargon gets a (?) tooltip.

## Good first contributions

- A notice template and notice period for your state (see the README), ideally reviewed by an attorney.
- Column names from a property-management export Tally doesn't recognize yet (`SYNONYMS` in `src/lib/ingest/tabular.ts`), with a scrubbed sample header row in a test.
- Bank and payment-app statement formats.

Run `npx tsc --noEmit`, `npx eslint src` and `npm test` before opening a pull request.
