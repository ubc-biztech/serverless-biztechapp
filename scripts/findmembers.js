import * as dotenv from "dotenv";
import AWS from "aws-sdk";

dotenv.config({
  path: "../.env"
});

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
};

const cognitoISP = new AWS.CognitoIdentityServiceProvider(awsConfig);

const userPoolId = "us-west-2_w0R176hhp";
const filter = "username ^= \"Google\"";

const filterRegUsers = async (emails) => {
  const counts = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    try {
      const data = await cognitoISP.listUsers({
        UserPoolId: userPoolId,
        Filter: `email = "${email}"`,
      }).promise();

      if (data.Users.length === 1) {
        counts.push(email);
      }
    } catch (error) {
      console.error("Error", error);
    }
  }

  return counts;
};

cognitoISP.listUsers({
  UserPoolId: userPoolId,
  Filter: filter
}, (err, data) => {
  if (err) {
    console.log("Error", err);
  } else {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const recentUsers = data.Users.filter(user =>
      new Date(user.UserCreateDate) >= threeMonthsAgo
    );
    const result = [];
    recentUsers.forEach(user => {
      user.Attributes.forEach(attribute => {
        if (attribute.Name === "email") {
          result.push(attribute.Value);
        }
      });
    });
    filterRegUsers(result).then(counts => {
      console.log("Endangered Emails", counts);
    });
  }
});

