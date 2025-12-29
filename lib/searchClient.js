import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import dotenv from "dotenv";
import awsConfig from "./config.js";

dotenv.config({ path: "../../.env" });

const isDev = process.env.NODE_ENV === "development";

const searchClient = new Client(
  isDev
    ? {
        node: process.env.OPENSEARCH_ENDPOINT || "http://localhost:9200",
      }
    : {
        node: process.env.OPENSEARCH_ENDPOINT,
        ...AwsSigv4Signer({
          region: awsConfig.region,
          service: "es",
          getCredentials: async () => ({
            accessKeyId: awsConfig.accessKeyId,
            secretAccessKey: awsConfig.secretAccessKey,
          }),
        }),
      }
);

export default searchClient;
