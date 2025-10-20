const fs = require('fs');
const csv = require('csv-parser');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config();

// Configure AWS SDK v3
const awsConfig = {
  region: process.env.AWS_REGION || 'us-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
};

const client = new DynamoDBClient(awsConfig);
const docClient = DynamoDBDocumentClient.from(client);

const REGISTRATIONS_TABLE = 'biztechRegistrations';
const USERS_TABLE = 'biztechUsers';
const PROFILES_TABLE = 'biztechProfiles';

// hardcoded for kickstart purposes
const EVENT_ID = 'kickstart';
const YEAR = 2025;

async function updateTables(user, registrationStatus = 'Registered') {
  const timestamp = new Date().toISOString();
  const registrationId = `${user.email};${EVENT_ID};${YEAR}`;
  const profileId = uuidv4();

  const transactParams = {
    TransactItems: [
      {
        Put: {
          TableName: USERS_TABLE,
          Item: {
            id: user.email.toLowerCase(),
            email: user.email.toLowerCase(),
            firstName: user.firstName,
            lastName: user.lastName || '',
            isMember: user.isMember || false,
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(user.phone && { phone: user.phone }),
            ...(user.faculty && { faculty: user.faculty }),
            ...(user.year && { yearOfStudy: user.year })
          },
          ConditionExpression: 'attribute_not_exists(id)'
        }
      },
      {
        Put: {
          TableName: REGISTRATIONS_TABLE,
          Item: {
            id: registrationId,
            email: user.email.toLowerCase(),
            fname: user.firstName,
            lname: user.lastName || '',
            eventID: EVENT_ID,
            year: YEAR,
            registrationStatus,
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(user.phone && { phone: user.phone }),
            ...(user.faculty && { faculty: user.faculty }),
            ...(user.year && { yearOfStudy: user.year })
          },
          ConditionExpression: 'attribute_not_exists(id)'
        }
      },
      {
        Put: {
          TableName: PROFILES_TABLE,
          Item: {
            id: user.email.toLowerCase(),
            profileId,
            email: user.email.toLowerCase(),
            firstName: user.firstName,
            lastName: user.lastName || '',
            type: 'PARTNER',
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(user.phone && { phone: user.phone }),
            ...(user.faculty && { faculty: user.faculty })
          },
          ConditionExpression: 'attribute_not_exists(id)'
        }
      }
    ]
  };

  try {
    await docClient.transactWrite(transactParams);
    console.log(`Successfully created user, registration, and profile for ${user.email}`);
    return true;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log(`Entry already exists for ${user.email}`);
    } else {
      console.error(`Error processing ${user.email}:`, error.message);
      console.error('Error details:', error);
    }
    return false;
  }
}


/**
 * Processes the CSV file and creates registrations
 * @param {string} filePath - Path to the CSV file
 */
async function processCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    process.exit(1);
  }

  const results = [];
  const errors = [];
  let successCount = 0;
  let errorCount = 0;

  console.log(`📋 Processing ${filePath}...`);

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        console.log(`Found ${results.length} records to process`);
        
        // Process each record
        for (const [index, row] of results.entries()) {
          try {
            // ADJUST BASED ON CSV
            const user = {
              email: row.email || row.Email || row.EMAIL,
              firstName: row.firstName || row['First Name'] || row['First-Name'] || row.first_name,
              lastName: row.lastName || row['Last Name'] || row['Last-Name'] || row.last_name,
              phone: row.phone || row.Phone || row.PHONE,
              faculty: row.faculty || row.Faculty || row.faculty_name,
              year: row.year || row.Year || row.year_of_study
            };

            const success = await updateTables(user);
            if (success) {
              successCount++;
            } else {
              errorCount++;
            }

            // add small delay to avoid throttling
            if (index < results.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (error) {
            console.error(`Error processing record ${index + 1}:`, error.message);
            errors.push({
              row: index + 2, // +2 for 1-based index and header row
              error: error.message,
              data: row
            });
            errorCount++;
          }
        }

        // Print summary
        console.log('\nImport Summary:');
        console.log(`Successfully processed: ${successCount} records`);
        console.log(`Failed to process: ${errorCount} records`);
        
        if (errors.length > 0) {
          console.log('\nErrors encountered:');
          errors.forEach((err, idx) => {
            console.log(`\nRow ${err.row}: ${err.error}`);
            console.log('Data:', JSON.stringify(err.data, null, 2));
          });
        }

        resolve({ successCount, errorCount, errors });
      })
      .on('error', (error) => {
        console.error('Error reading CSV file:', error);
        reject(error);
      });
  });
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node scripts/ingestPartnerRegistrations.js <path-to-csv>');
    console.log('Example: node scripts/ingestPartnerRegistrations.js ./partner-registrations.csv');
    process.exit(1);
  }

  const csvFilePath = args[0];
  
  try {
    console.log('Starting CSV processing...');
    await processCSV(csvFilePath);
    console.log('CSV processing completed successfully!');
  } catch (error) {
    console.error('Fatal error:', error);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}
