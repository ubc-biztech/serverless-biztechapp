import { OPENSEARCH_INDEX_TOP_K } from "../constants/indexes.js";
import { algoliaRecommendClient } from "./algoliaClient.js";

export default {
  // see BaseRecommendRequest in the .d.ts file
  async recommendTopK({ indexName, objectID, maxRecommendations = OPENSEARCH_INDEX_TOP_K, model = "related-products", threshold = 42.1 }) {
    const res = await algoliaRecommendClient.getRecommendations({
      requests: [{
        indexName,
        objectID,
        model,
        threshold,
        maxRecommendations
      }]
    });
    return res;
  }
};
