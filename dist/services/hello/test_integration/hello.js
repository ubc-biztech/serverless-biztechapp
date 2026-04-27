"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = __importDefault(require("chai"));
const expect = chai_1.default.expect;
const testHelpers_1 = __importDefault(require("../../../lib/testHelpers"));
const SERVICE = "";
describe("hello integration", function () {
    this.timeout(10000);
    it("hello test", async () => {
        return testHelpers_1.default.invokeLambda(SERVICE, "hello").then(([statusCode, body]) => {
            expect(statusCode).to.equal(200);
            expect(body.message).to.equal("Yeet!");
        });
    });
});
