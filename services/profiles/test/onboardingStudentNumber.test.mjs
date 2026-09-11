import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Exercise the real POST handler with isolated database/profile infrastructure.
const mocks = {
  "../../lib/db.js": "export default globalThis.infrastructure.db;",
  "./helpers.js": `
    export const buildProfileUpdateParams = () => {};
    export const filterPublicProfileFields = () => {};
    export const updateProfileFromMembershipData = async () => {};
    export const createProfile = async () => ({ statusCode: 201 });
  `,
  "human-id": "export const humanId = () => 'test-profile';",
  "@aws-sdk/client-s3": "export class S3Client {} export class PutObjectCommand {}",
  "@aws-sdk/s3-request-presigner": "export const getSignedUrl = () => {};",
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../handler.js", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [{
    name: "isolated-infrastructure",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path }) =>
        Object.hasOwn(mocks, path) ? { path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path] }));
    },
  }],
});

async function submit(education, studentNumber, existingProfile = true) {
  const writes = [];
  const db = {
    async updateDB(id, data) {
      writes.push(data);
      return { Attributes: existingProfile ? { profileID: "test-profile" } : {} };
    },
  };
  const context = vm.createContext({
    module: { exports: {} }, process: { env: {} }, console: { error() {} },
    infrastructure: { db },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const response = await context.module.exports.create({
    requestContext: { authorizer: { claims: { email: "applicant@example.com" } } },
    body: JSON.stringify({
      firstName: "Test", lastName: "Applicant", education, studentNumber,
      pronouns: "They/Them", levelOfStudy: "1st Year", faculty: "Science",
      major: "CS", internationalStudent: "No", previousMember: "No",
      dietaryRestrictions: "None", referral: "Website", topics: [],
    }),
  });
  return { response, writes };
}

for (const education of ["UBC", "UNI", "NA"]) {
  for (const studentNumber of [undefined, "", "   ", "123", "00123456", " 12345678 "]) {
    test(`${education} accepts student number ${JSON.stringify(studentNumber)}`, async () => {
      const { response, writes } = await submit(education, studentNumber);
      assert.equal(response.statusCode, 200);
      if (studentNumber === undefined) {
        assert.equal(Object.hasOwn(writes[0], "studentId"), false);
      } else {
        assert.equal(writes[0].studentId, studentNumber.trim());
      }
      assert.ok(writes.some((write) => write.onboardingYear));
    });
  }
}

for (const studentNumber of [undefined, ""]) {
  test(`creates a new profile without student number ${JSON.stringify(studentNumber)}`, async () => {
    const { response, writes } = await submit("UBC", studentNumber, false);
    assert.equal(response.statusCode, 201);
    assert.ok(writes.some((write) => write.onboardingYear));
  });
}

for (const studentNumber of ["123456789", "not-a-number", 12345678, null]) {
  test(`rejects invalid supplied student number ${JSON.stringify(studentNumber)}`, async () => {
    const { response, writes } = await submit("UBC", studentNumber);
    assert.equal(response.statusCode, 406);
    assert.equal(writes.length, 0);
  });
}
