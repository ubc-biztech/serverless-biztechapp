import { algoliasearch } from "algoliasearch";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY;

// Initialize Algolia client. Ensure ALGOLIA_APP_ID and ALGOLIA_API_KEY are set in env.
// BUG (pre-existing, preserved): env vars are not validated, so the client is
// constructed with `undefined` credentials when they are unset. The casts keep
// that behaviour rather than introducing a runtime check.
export const algoliaClient = algoliasearch(ALGOLIA_APP_ID as string, ALGOLIA_API_KEY as string);
