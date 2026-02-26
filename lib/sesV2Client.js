import { SESV2Client } from "@aws-sdk/client-sesv2";

const client = new SESV2Client({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: "us-west-2",
});

export default client;
