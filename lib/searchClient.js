import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const isDev = process.env.NODE_ENV === "development";

const searchClient = new Client({
  ...(isDev
    ? {
        node: process.env.OPENSEARCH_ENDPOINT || "http://localhost:9200"
      }
    : AwsSigv4Signer({
        region: process.env.AWS_REGION,
        service: "es",
        getCredentials: defaultProvider()
      })),
  node: process.env.OPENSEARCH_ENDPOINT
});

export default searchClient;
