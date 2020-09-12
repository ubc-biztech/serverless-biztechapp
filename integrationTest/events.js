'use strict';
const AWS = require('aws-sdk');
const chai = require('chai');
const expect = chai.expect;

const helpers = require('./helpers')

describe('events integration', function () {

    this.timeout(10000);

    const integrationTestId = 'integrationTestEvent';
    const nonExistantEventId = 'someRandomEventThatDoesNotExist123';

    describe('events/{id} integration', function () {
        describe('events/{id} GET tests', function () {
            it('event GET with no additional params returns 200 on an event that exists', async () => {
                const payload = {
                    pathParameters: {
                        id: integrationTestId
                    }
                };
                return helpers.invokeLambda('eventGet', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                        expect(body.id).to.equal(integrationTestId);
                        expect(body).to.have.property('capac');
                    })
            });

            it('event GET when event doesn\'t exist returns 404', async () => {
                const payload = {
                    pathParameters: {
                        id: nonExistantEventId
                    }
                };
                return helpers.invokeLambda('eventGet', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(404);
                    })
            })

            it('event GET with count true and users false returns 200', async () => {
                const payload = {
                    pathParameters: {
                        id: integrationTestId
                    },
                    queryStringParameters: {
                        count: 'true',
                        users: 'false'
                    }
                };
                return helpers.invokeLambda('eventGet', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                        expect(body).to.have.property('registeredCount');
                        expect(body).to.have.property('checkedInCount');
                        expect(body).to.have.property('waitlistCount');
                    })
            });

            it('event GET with count false and users true returns 200', async () => {
                const payload = {
                    pathParameters: {
                        id: integrationTestId
                    },
                    queryStringParameters: {
                        count: 'false',
                        users: 'true'
                    }
                };
                return helpers.invokeLambda('eventGet', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                    })
            });
        });

        describe('events/{id} PATCH tests', function () {
            const updatePayload = {
                id: integrationTestId,
                ename: 'Updated Event',
                description: 'Updated test event description',
                capac: 100,
                facebookUrl: 'https://www.facebook.com/BizTechUBC/',
                imageUrl: 'https://www.facebook.com/BizTechUBC/',
                elocation: 'UBC Sauder',
                longitude: -120.10,
                latitude: 78.03,
            }

            // fields that are different in the updatePayload: ename, description, capac, elocation, longitude, latitude
            const defaultPayload = {
                id: integrationTestId,
                ename: 'integrationTestEventName',
                description: 'default test event description',
                capac: 50,
                facebookUrl: 'https://www.facebook.com/BizTechUBC/',
                imageUrl: 'https://www.facebook.com/BizTechUBC/',
                elocation: 'UBC Nest',
                longitude: 120.00,
                latitude: -78.00,
            }

            it('event PATCH returns 200 on update success', async () => {
                // update integrationTestEvent to defaultPayload
                let payload = {
                    pathParameters: {
                        id: integrationTestId
                    },
                    body: JSON.stringify(defaultPayload)
                };
                await helpers.invokeLambda('eventUpdate', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                    })

                payload = {
                    pathParameters: {
                        id: integrationTestId
                    }
                }
                // check that integrationTestEvent was updated
                await helpers.invokeLambda('eventGet', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                        expect(body.elocation).to.equal(defaultPayload.elocation);
                        expect(body.imageUrl).to.equal(defaultPayload.imageUrl);
                        expect(body.facebookUrl).to.equal(defaultPayload.facebookUrl);
                        expect(body.description).to.equal(defaultPayload.description);
                        expect(body.capac).to.equal(defaultPayload.capac);
                        expect(body.longitude).to.equal(defaultPayload.longitude);
                    })

                // update integrationTestEvent to updatePayload
                payload = {
                    pathParameters: {
                        id: integrationTestId
                    },
                    body: JSON.stringify(updatePayload)
                };
                await helpers.invokeLambda('eventUpdate', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                    })

                // check that integrationTestEvent was updated
                return helpers.invokeLambda('eventGet', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                        expect(body.elocation).to.equal(updatePayload.elocation);
                        expect(body.imageUrl).to.equal(updatePayload.imageUrl);
                        expect(body.facebookUrl).to.equal(updatePayload.facebookUrl);
                        expect(body.description).to.equal(updatePayload.description);
                        expect(body.capac).to.equal(updatePayload.capac);
                        expect(body.longitude).to.equal(updatePayload.longitude);
                    })
            });

            it('event PATCH returns 404 when event not found', async () => {
                const payload = {
                    pathParameters: {
                        id: nonExistantEventId
                    },
                    body: JSON.stringify(defaultPayload)
                }

                return helpers.invokeLambda('eventUpdate', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(404);
                    });
            });
        });
    });

    describe('events/ integration', function () {
        describe('events/ GET tests', function () {
            it('events GET returns 200 on success', async () => {
                return helpers.invokeLambda('eventGetAll', '')
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                    });
            });
        });

        describe('events/ POST tests', function () {
            it('events POST returns 201 on success', async () => {
                let payload = {
                    body: JSON.stringify({
                        id: 'testPostEvent',
                        ename: 'test',
                        capac: 200000,
                        img: 'someImageUrl'
                    })
                };
                await helpers.invokeLambda('eventCreate', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(201);
                        expect(body.message).to.equal('Event Created!')
                    });

                payload = {
                    pathParameters: {
                        id: 'testPostEvent'
                    }
                };

                return helpers.invokeLambda('eventDelete', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(200);
                    });
            });

            it('events POST returns 409 when event id already exists', async () => {
                const payload = {
                    body: JSON.stringify({
                        id: integrationTestId,
                        ename: 'test',
                        capac: 20000,
                        img: 'someImgUrl'
                    })
                };
                return helpers.invokeLambda('eventCreate', JSON.stringify(payload))
                    .then(([statusCode, body]) => {
                        expect(statusCode).to.equal(409);
                        expect(body).to.equal('Event could not be created because id already exists')
                    });
            });
        });
    });
});