import * as dotenv from 'dotenv';
import AWS from 'aws-sdk';

dotenv.config({ path: '../.env' });

const destinationAWSConfig = {
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  endpoint: 'http://localhost:8000', // use the local dynamodb url here
  region: 'us-west-2',
};
console.log(process.env);

if (process.env.NODE_ENVIRONMENT === 'development') {

  AWS.config.update(destinationAWSConfig);

}

export default AWS;
