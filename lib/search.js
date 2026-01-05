import {
  OPENSEARCH_INDEX_TOP_K
} from "../constants/indexes.js";
import searchClient from "./searchClient.js";

export default {
  /**
   * Create an OpenSearch index
   */
  async createIndex({
    indexName,
    mappings,
    settings = {}
  }) {
    const exists = await searchClient.indices.exists({
      index: indexName
    });

    if (exists.body) {
      return false;
    }

    await searchClient.indices.create({
      index: indexName,
      body: {
        settings,
        mappings
      }
    });

    return true;
  },

  /**
   * Index or update a document
   */
  async indexDocument({
    indexName,
    id,
    document
  }) {
    const res = await searchClient.index({
      index: indexName,
      id,
      body: document,
      refresh: true
    });

    return res.body;
  },

  /**
   * Retrieve Top K documents using text search
   */
  async retrieveTopK({
    indexName,
    queryText,
    topK = OPENSEARCH_INDEX_TOP_K,
  }) {
    const res = await searchClient.search({
      index: indexName,
      size: topK,
      body: {
        query: {
          bool: {
            must: [
              {
                match: {
                  profile_text: {
                    query: queryText,
                    fuzziness: "AUTO"
                  }
                }
              }
            ]
          }
        }
      }
    });

    return res.body.hits.hits.map(hit => ({
      score: hit._score,
      ...hit._source
    }));
  }
};
