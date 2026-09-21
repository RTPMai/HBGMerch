# Merch tracker

Tracks Hawkbat Garrison merch submissions against the 501st Operating Protocols: General slots per Legion year, receipts owed to the LMBO, event deadlines, and the election freeze.

Static front end plus one Vercel function. Data lives in a private GitHub repo. No build step, no npm dependencies, nothing to pay for.

## Setup

1. Push this folder to a new GitHub repo (the app repo).
2. Create a second, **private** repo for the data, for example `hawkbat-merch-data`. Initialize it with a README so it has a `main` branch. Keep it separate from the app repo, or every save will trigger a Vercel redeploy.
3. Create a fine-grained personal access token (GitHub, Settings, Developer settings, Fine-grained tokens). Repository access: only the data repo. Permissions: Contents, read and write.
4. In Vercel, import the app repo. Framework preset: Other. No build command.
5. Environment variables:
   - `APP_PASSWORD` the password for the tracker
   - `GITHUB_TOKEN` the token from step 3
   - `GITHUB_REPO` for example `yourname/hawkbat-merch-data`
   - Optional: `GITHUB_BRANCH` (default `main`), `DATA_PATH` (default `merch.json`)
6. Redeploy so the variables take effect.

The first save creates `merch.json` in the data repo. Every save after that is a commit, so the repo history is your audit trail and undo.

Local dev: `vercel dev` (after `vercel link` and `vercel env pull`).

Tests: `npm test`

## Files

- `js/rules.js` all rule logic (Legion year, freeze, slots, flags). Pure functions, tested.
- `js/api.js` every fetch goes through here.
- `js/app.js` UI.
- `api/data.js` GET and PUT for the dataset, stored as one JSON file in the data repo. Saves are versioned so two tabs can't overwrite each other.
- `tests/rules.test.js`

## How the rules are applied

- **Legion year** starts on election Day 17 (the Monday after the first Saturday in February, plus 16 days) and runs to the day before the next one.
- **Election freeze** is treated as Day 1 through Day 16. The OP says submissions resume after ratifications, so the real end date can drift a little.
- **Which year an item counts in** is its Sent to LMBO date, falling back to CO approved, then the date it was created.
- **Slots**: only General items use them. Each item in a set is one slot. Multi-unit items marked as using the partner's slot don't count. Denied and withdrawn items don't count. Items with no dates yet show as planned.
- **Status** comes from the furthest date filled in, so there's only one thing to update.
- **Slot limit** defaults to 5 per the current OP. Change it in Settings.
- **LFL threshold** is blank until you enter it in Settings (the number lives in the LFL Merchandise Guidelines forum thread).

## Flags

- Produced but receipt not sent to LMBO
- Submitted, approved, or produced with no CO approval date
- Submitted during the election freeze
- Quantity over the LFL threshold (PR material excluded)
- Event items: no event date, event coming up and not produced, event passed and not produced, submitted before the 6-month window, and when the window opens
- Memorial items with no honoree
- A Legion year over its slot limit, or planned items that would push it over
