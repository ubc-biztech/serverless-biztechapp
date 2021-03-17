export const INTEGRATION_TEST_USER_EMAIL = 'integration@test.com';
export const INTEGRATION_TEST_PERSISTENT_USER_EMAIL = 'integration@persistent.com';
export const INTEGRATION_TEST_PERSISTENT_USER_EMAIL_2 = 'integration@persistent2.com';
export const INTEGRATION_TEST_NON_EXISTANT_USER_EMAIL = 'integration@nonexistant.com';
export const INTEGRATION_TEST_EVENT_ID = '__INTEGRATION_TEST_EVENT_POST';
export const INTEGRATION_TEST_YEAR = 2020;
export const INTEGRATION_TEST_PERSISTENT_EVENT_ID = '__INTEGRATION_TEST_EVENT';
export const INTEGRATION_TEST_PERSISTENT_YEAR = 2020;
export const INTEGRATION_TEST_PERSISTENT_EVENT_ID_2 = '__INTEGRATION_TEST_EVENT_2';
export const INTEGRATION_TEST_PERSISTENT_YEAR_2 = 2020;
export const INTEGRATION_TEST_NON_EXISTANT_EVENT_ID = 'someRandomEventThatDoesNotExist123';
export const INTEGRATION_TEST_NON_EXISTANT_YEAR = 1234;
export const INTEGRATION_TEST_PRIZE_ID = '__INTEGRATION_TEST_PRIZE_POST';
export const INTEGRATION_TEST_PERSISTENT_PRIZE_ID = '__INTEGRATION_TEST_PRIZE';
export const INTEGRATION_TEST_NON_EXISTANT_PRIZE_ID = 'someRandomPrizeThatDoesNotExist123';
export const INTEGRATION_TEST_STICKER_ID = '__INTEGRATION_TEST_STICKER_POST';
export const INTEGRATION_TEST_PERSISTENT_STICKER_ID = '__INTEGRATION_TEST_STICKER';
export const INTEGRATION_TEST_NON_EXISTANT_STICKER_ID = 'someRandomStickerThatDoesNotExist123';

export const INTEGRATION_TEST_PERSISTENT_REGISTRATION_PARAMETERS = {
  eventId: INTEGRATION_TEST_PERSISTENT_EVENT_ID_2, // has capacity of "1"
  year: INTEGRATION_TEST_PERSISTENT_YEAR_2,
  email: INTEGRATION_TEST_PERSISTENT_USER_EMAIL,
  key: `${INTEGRATION_TEST_PERSISTENT_EVENT_ID_2};${INTEGRATION_TEST_PERSISTENT_YEAR_2}`
};
