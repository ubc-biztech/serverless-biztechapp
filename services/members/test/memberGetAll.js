'use strict';
import AWSMock from 'aws-sdk-mock';

// tests for membersGetAll
// Generated by serverless-mocha-plugin

import mochaPlugin from 'serverless-mocha-plugin';
const expect = mochaPlugin.chai.expect;
let wrapped = mochaPlugin.getWrapper('memberGetAll', '/handler.js', 'getAll');

import getMembersResponse from './members.json';

describe('memberGetAll', () => {

  before(() => {

    AWSMock.mock('DynamoDB.DocumentClient', 'scan', (params, callback) => {

      callback(null, getMembersResponse);

    });

  });

  after(() => {

    AWSMock.restore('DynamoDB.DocumentClient');

  });

  it('return 200 response for getting all members', async () => {

    const response = await wrapped.run();
    expect(response.statusCode).to.be.equal(200);

    const body = JSON.parse(response.body);
    expect(body).to.have.length(3);

    const event = body[0];
    expect(event).to.have.property('id');
    expect(event).to.have.property('education');
    expect(event).to.have.property('email');
    expect(event).to.have.property('faculty');
    expect(event).to.have.property('first_name');
    expect(event).to.have.property('heard_from');
    expect(event).to.have.property('high_school');
    expect(event).to.have.property('last_name');
    expect(event).to.have.property('major');
    expect(event).to.have.property('pronouns');
    expect(event).to.have.property('student_number');
    expect(event).to.have.property('timestamp');
    expect(event).to.have.property('topics');
    expect(event).to.have.property('university');
    expect(event).to.have.property('year');
    expect(event).to.have.property('international');
    expect(event).to.have.property('prev_member');

  });

});