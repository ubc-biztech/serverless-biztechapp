/*
This script was used to send Blueprint Wraps in 2024. Blueprint Wraps were sent to every user who had enough QR scans to be able to determine a 
Top Industry: i.e., Software Development, Entrepreneurship, Data & AI, or Finance, determined by what workshops they scanned and which mentor QRs 
they scanned.

Source of Wraps: https://www.figma.com/file/1i56FESosSgNa4tHdiJwxN/Template?type=design&node-id=20%3A12&mode=design&t=M334DOCcHo4OCnAq-1

Some documentation on it:
QR scan data + registrations + partner data from the event was exported then put into Excel for data manipulation to create new derived values.
 - Top industry was calculated by assigning every workshop/mentor QR an industry, then figuring out each person's most commonly scanned industry. 
 - Top mentors was calculated by: 
    - if the person scanned at least 3 mentors from the industry, pick 3 of those at random. Otherwise just pick 3 random from the industry
The excel sheet with all the data was then exported to Sheets and imported into Figma using https://www.figma.com/community/plugin/735770583268406934/google-sheets-sync.
NOTE: this plugin is really bad with images. Many images when bulk importing images will not be loaded and you'll have to manually paste them into the figma.
ALSO: watch out for lines that are too long / short after importing into the figma file.

The hardest part is the manual work required to export data into sheets to figma then back to code. This takes much longer than expected because of 
annoying quirks of data sanitization and figma formatting.
NEXT YEAR: just incorporate all of blueprint wrapped into the Companion so that the entire blueprint wrapped is ready for attendees right as the event ends.
What we noticed this year is that people post on socials right after the event. The time it takes to export blueprint wrapped a week after is too long for 
it to be relevant. Ways to implement BP Wrapped directly into Companion could be straight CSS or investigating the figma API.

*/
import fs from "fs";
import AWS from "aws-sdk";
import csv from "csv-parser";

const {
  accessKeyId,
  secretAccessKey,
  region
} = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: "us-west-2",
};

const ses =
    new AWS.SES({
      apiVersion: "2010-12-01",
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      region: region
    });

const subject = "Your Blueprint Wrapped 2024";
const sourceEmail = "ubcbiztech@gmail.com";
// csv is formatted as follows: email, partner1url, partner2url, partner3url
const csvFilePath = "./scripts/data/bp_wrapped_emails.csv";

// SES has rate limiting 14 emails a second. 
const delayBetweenBatchesMs = 1000;
const batchSize = 3;


const readCSV = async (csvFilePath) => {
  return new Promise((resolve, reject) => {
    const csvData = [];
    let csvHeader;

    const processCSV = (filePath) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("headers", (headers) => {
          csvHeader = headers.map(header => header.trim());
        })
        .on("data", (row) => {
          const cleanedRow = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.trim(), value.trim()])
          );
          csvData.push(cleanedRow);
        })
        .on("end", () => {
          resolve([csvHeader, csvData]);
        })
        .on("error", (error) => {
          console.error(`Error reading CSV file: ${error.message}`);
          reject(error);
        });
    };

    processCSV(csvFilePath);
  });
};

async function sendEmailWithPNG(confirmSendEmailFlag) {
  const data = await readCSV(csvFilePath);
  const dataBody = data[1];

  const emails = [];

  dataBody.forEach(async (row, idx) => {
    const parsedRow = JSON.parse(JSON.stringify(row));
    const email = parsedRow.Email;
    const partner1url = parsedRow.Mentor1Linkedin;
    const partner2url = parsedRow.Mentor2Linkedin;
    const partner3url = parsedRow.Mentor3Linkedin;

    const body = `<html>
        <head>
            <style>
            body, html {
                margin: 0;
                padding: 0;
            }
            .image-container {
                display: block; /* Ensures each image container is a block element */
                margin: 0; /* Removes margin */
                padding: 0; /* Removes padding */
            }
            img {
                display: block; /* Removes extra space below the image */
                height: auto; /* Optional: maintains aspect ratio */
                border: none; /* Removes border */
                margin: 0; /* Removes margin */
                padding: 0; /* Removes padding */
                max-width: 600px; /* Sets a max-width for larger screens */
            }
            </style>
        </head>
        <body>
            <div class="image-container">
                <img src="https://biztech-images-prod.s3.us-west-2.amazonaws.com/blueprint_wraps/WRAPPED-${idx}.png" />
            </div>
            <div class="image-container">
            <a href="${partner1url}">
                <img src="https://biztech-images-prod.s3.us-west-2.amazonaws.com/blueprint_wraps/MENTOR1-${idx}.png" />
            </a>
            </div>
            <div class="image-container">
            <a href="${partner2url}">
                <img src="https://biztech-images-prod.s3.us-west-2.amazonaws.com/blueprint_wraps/MENTOR2-v2-${idx}.png" />
            </a>
            </div>
            <div class="image-container">
            <a href="${partner3url}">
                <img src="https://biztech-images-prod.s3.us-west-2.amazonaws.com/blueprint_wraps/MENTOR3-v2-${idx}.png" />
            </a>
            </div>
        </body>
        </html>`;

    const emailData = {
      Destination: {
        ToAddresses: [
          email
          // `jerry+${idx}@ubcbiztech.com`
        ]
      },
      Message: {
        Subject: {
          Data: subject
        },
        Body: {
          Html: {
            Data: body
          }
        }
      },
      Source: sourceEmail
    };

    emails.push(emailData);
  });

  async function sendEmailsWithDelay(emails, confirmSendEmailFlag) {
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      await Promise.all(batch.map(async (emailData) => {
        const email = emailData.Destination.ToAddresses[0];
        const body = emailData.Message.Body.Html.Data;

        console.log(`Preparing to send email to ${email} with data \n ${body}`);

        if (confirmSendEmailFlag === "-confirm") {
          await ses.sendEmail(emailData).promise()
            .then(() => {
              console.log(`Email sent successfully to ${email}`);
            })
            .catch((err) => {
              console.log("did not send email to ", email);
              fs.appendFile("emailErrors.txt", `Error sending email to ${email}: ${err.message}\n`, (err) => {
                if (err) console.error("Error writing to emailErrors.txt:", err);
              });
            });
        } else {
          console.log(`Email prepared for ${email}, not sent. Use -confirm to send email.`);
        }
      }));

      // Wait for a second before sending the next batch
      console.log(`Batch sent, waiting ${delayBetweenBatchesMs / 1000} seconds before sending the next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatchesMs));
    }
  }

  sendEmailsWithDelay(emails, confirmSendEmailFlag);
}

// Get command line arguments
const [, , confirmSendEmailFlag] = process.argv;

sendEmailWithPNG(confirmSendEmailFlag);
