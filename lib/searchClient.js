import { algoliasearch } from "algoliasearch";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY;

// Initialize Algolia client. Ensure ALGOLIA_APP_ID and ALGOLIA_API_KEY are set in env.
const searchClient = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_API_KEY);

export default searchClient;
