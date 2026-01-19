import { algoliaRecommendClient } from "./algoliaClient"

export default {
    // see BaseRecommendRequest in the .d.ts file
    async recommendTopK({ indexName, objectID, maxRecommendations = 5, model = 'related-products', threshold = 42.1 }) {
       await algoliaRecommendClient.getRecommendations({
        requests: [{ indexName, objectID, model, threshold, maxRecommendations }]
       }) 
    }
}
