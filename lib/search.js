import { OPENSEARCH_INDEX_TOP_K } from "../constants/indexes.js";
import { algoliaClient } from "./algoliaClient.js";

export default {
  /**
   * Index multiple documents
   */
  async indexDocuments({ indexName, documents }) {
    await algoliaClient.saveObjects({
      indexName,
      objects: documents
    });
  },

  /**
   * Retrieve Top K documents using text search
   */
  async retrieveTopK({ indexName, queryText, topK = OPENSEARCH_INDEX_TOP_K }) {
    // Notes from Brian
    // 1. removeStopWords: true - removes common words like "the", "and", "or"
    // 2. optionalWords: queryText.split(" ") - treats each word as optional, so documents with any of these words will match
    // 3. hitsPerPage: topK - limits the number of results returned
    const res = await algoliaClient.searchSingleIndex({
      indexName,
      searchParams: {
        query: queryText,
        removeStopWords: true,
        optionalWords: queryText.split(" "),
        hitsPerPage: topK
      }
    });

    // Uncomment the below to only return the data
    /*
    return res.hits.map((hit) => {
      // include _highlightResult if you want to debug
      const { _highlightResult, objectID, ...rest } = hit;
      return rest;
    });
    */
    return res?.hits;
  }
};
