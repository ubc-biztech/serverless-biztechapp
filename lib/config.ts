interface AWSConfig {
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  region: string;
}

const awsConfig: AWSConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
};

export default awsConfig;
