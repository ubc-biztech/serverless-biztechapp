# judging

Backs `ubc-biztech/bt-judging` (the HelloHacks judging portal): settings, rubric, teams, judges, reviews
and links per event, with code-based login.

**Generated service.** Routes, auth, validation and error statuses come from the ontology in
[`ubc-biztech/sdk`](https://github.com/ubc-biztech/sdk) via `@ubc-biztech/sdk/server/judging`.
This directory has only the business logic (`impl.ts`, one method per declared action) and storage
(`store.ts`, `lib/db` over `biztechJudging`, keyed `id = "<eventID>;<year>"`, `sk = TEAM#… | JUDGE#… | …`).

Distinct from the older five-metric flow in `services/teams` (`bizJudge`, `bizFeedback`); the two share no tables.

`JUDGING_BOOTSTRAP_CODE` (GitHub secret) is an organizer code valid for every event on the stage, used to
create an event's first settings.

To change the API: declare it in the sdk, bump the pinned commit in the root `package.json`, and
`npx tsc -p tsconfig.json` here tells you which `impl.ts` method to write. Never a new function in `serverless.yml`.
