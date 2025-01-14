import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { app } from '~/app';
import { sequelize } from '~/config/database';
import { User } from '~/user/User';

let lastMail, server;
let simulateSmtpFailure = false;

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    onData(stream, session, callback) {
      let mailBody;
      stream.on('data', (data) => {
        mailBody += data.toString();
      });
      stream.on('end', () => {
        if (simulateSmtpFailure) {
          const err = new Error('Invalid mailbox');
          err.responseCode = 533;
          return callback(err);
        }
        lastMail = mailBody;
        callback();
      });
    },
  });

  await server.listen(8587, 'localhost');
  await sequelize.sync();
});

beforeEach(() => {
  simulateSmtpFailure = false;
  return User.destroy({
    truncate: true,
  });
});

afterAll(async () => {
  await server.close;
});

const validUser = {
  username: 'user1',
  email: 'user1@example.com',
  password: 'Pass1234',
};

const postUser = (user = validUser, options = {}) => {
  const agent = request(app).post('/api/1.0/users');

  if (options.language) {
    agent.set('Accept-Language', options.language);
  }

  return agent.send(user);
};

describe('User Registration', () => {
  const username_null = 'Username cannot be null';
  const username_size = 'Must have minimum 4 and max 32 characters';
  const email_null = 'Email cannot be null';
  const email_invalid = 'Email is invalid';
  const password_null = 'Password cannot be null';
  const password_size = 'Password must be at least 6 characters';
  const password_pattern =
    'Password must have at least 1 uppercase, 1 lowercase letter and 1 number';
  const email_inuse = 'Email is in use';
  const user_create_success = 'User created';
  const email_failure = 'Email Failure';
  const validation_failure = 'Validation Failure';

  it('returns 200 OK when signup request is valid', async () => {
    const response = await postUser();
    expect(response.statusCode).toBe(200);
  });

  it('returns success message when signup request is valid', async () => {
    const response = await postUser();
    expect(response.body.message).toBe(user_create_success);
  });

  it('saves the user to database', async () => {
    await postUser();
    const userList = await User.findAll();
    expect(userList.length).toBe(1);
  });

  it('saves the username and email to database', async () => {
    await postUser();
    const userList = await User.findAll();
    const savedUser = userList[0];
    expect(savedUser.username).toBe('user1');
    expect(savedUser.email).toBe('user1@example.com');
  });

  it('hashes the password in databas', async () => {
    await postUser();
    const userList = await User.findAll();
    const savedUser = userList[0];
    expect(savedUser.password).not.toBe('pass1234');
  });

  it('returns 400 when username is null', async () => {
    const response = await postUser({
      username: null,
      email: 'user1@example.com',
      password: 'Pass1234',
    });
    expect(response.status).toBe(400);
  });

  it('returns validationErrors field in response body when validation error occurs', async () => {
    const response = await postUser({
      username: null,
      email: 'user1@example.com',
      password: 'Pass1234',
    });
    const body = response.body;
    expect(body.validationErrors).not.toBeUndefined();
  });

  it('returns errors for both when username and email is null', async () => {
    const response = await postUser({
      username: null,
      email: null,
      password: 'Pass1234',
    });
    const body = response.body;
    expect(Object.keys(body.validationErrors)).toEqual(['username', 'email']);
  });

  it.each`
    field         | value                 | expectedMessage
    ${'username'} | ${null}               | ${username_null}
    ${'username'} | ${'usr'}              | ${username_size}
    ${'username'} | ${'a'.repeat(33)}     | ${username_size}
    ${'email'}    | ${null}               | ${email_null}
    ${'email'}    | ${'mail.com'}         | ${email_invalid}
    ${'email'}    | ${'user.mail.com'}    | ${email_invalid}
    ${'email'}    | ${'user@mail'}        | ${email_invalid}
    ${'password'} | ${null}               | ${password_null}
    ${'password'} | ${'P4ss'}             | ${password_size}
    ${'password'} | ${'lllowercase'}      | ${password_pattern}
    ${'password'} | ${'ALLUPPERCASE'}     | ${password_pattern}
    ${'password'} | ${'1234567'}          | ${password_pattern}
    ${'password'} | ${'lowerandUPPER'}    | ${password_pattern}
    ${'password'} | ${'lower4and5432234'} | ${password_pattern}
    ${'password'} | ${'UPPER4444'}        | ${password_pattern}
  `(
    'returns $expectedMessage when $field is $value',
    async ({ field, expectedMessage, value }) => {
      const user = {
        username: 'user1',
        email: 'user1@example.com',
        password: 'Pass1234',
      };

      user[field] = value;
      const response = await postUser(user);
      const body = response.body;
      expect(body.validationErrors[field]).toBe(expectedMessage);
    }
  );

  it(`returns ${email_inuse} when same email is already in use`, async () => {
    await User.create({ ...validUser });
    const response = await postUser();
    expect(response.body.validationErrors.email).toBe(email_inuse);
  });

  it('returns errors for both username is null and email is in use', async () => {
    await User.create({ ...validUser });
    const response = await postUser({
      username: null,
      email: validUser.email,
      password: 'P4ssword',
    });
    const body = response.body;
    expect(Object.keys(body.validationErrors)).toEqual(['username', 'email']);
  });

  it('creates user in inactive mode', async () => {
    await postUser();
    const users = await User.findAll();
    const savedUser = users[0];
    expect(savedUser.inactive).toBe(true);
  });

  it('creates user in inactive mode even requst body contains inactive as false', async () => {
    const newUser = { ...validUser, inactive: false };
    await postUser(newUser);
    const users = await User.findAll();
    const savedUser = users[0];
    expect(savedUser.inactive).toBe(true);
  });

  it('creates an activationToken for user', async () => {
    await postUser();
    const users = await User.findAll();
    const savedUser = users[0];
    expect(savedUser.activationToken).toBeTruthy();
  });

  it('sends an Account activation email with activationToken', async () => {
    await postUser();
    const users = await User.findAll();
    const savedUser = users[0];
    expect(lastMail).toContain(validUser.email);
    expect(lastMail).toContain(savedUser.activationToken);
  });

  it('returns 502 Bad Gateway when sending email fails', async () => {
    simulateSmtpFailure = true;
    const response = await postUser();
    expect(response.status).toBe(502);
  });

  it('returns email failure message when sending email fails', async () => {
    simulateSmtpFailure = true;
    const response = await postUser();
    expect(response.body.message).toBe(email_failure);
  });

  it('does not save user to database if activation email fails', async () => {
    simulateSmtpFailure = true;
    await postUser();
    const users = await User.findAll();
    expect(users.length).toBe(0);
  });

  it('returns validation failure message in error response body when validation fails', async () => {
    const response = await postUser({
      username: null,
      email: validUser.email,
      password: 'P4ssword',
    });

    expect(response.body.message).toBe(validation_failure);
  });

  // The End
});

describe('Internationalization', () => {
  const username_null = 'Username не может быть null';
  const username_size = 'Должно быть минимум 4 и максимум 32 символа';
  const email_null = 'Email не может быть null';
  const email_invalid = 'Email задан неверно';
  const password_null = 'Password не может быть null';
  const password_size = 'Password быть не менее 6 символов';
  const password_pattern =
    'Password должен состоять как минимум из 1 символа в верхнем регистре, 1 символа в нижнем регистре и 1 цифры';
  const email_inuse = 'Email уже используется';
  const user_create_success = 'User создан';
  const email_failure = 'Ошибка в Email';
  const validation_failure = 'Ошибка валидации';

  it.each`
    field         | value                 | expectedMessage
    ${'username'} | ${null}               | ${username_null}
    ${'username'} | ${'usr'}              | ${username_size}
    ${'username'} | ${'a'.repeat(33)}     | ${username_size}
    ${'email'}    | ${null}               | ${email_null}
    ${'email'}    | ${'mail.com'}         | ${email_invalid}
    ${'email'}    | ${'user.mail.com'}    | ${email_invalid}
    ${'email'}    | ${'user@mail'}        | ${email_invalid}
    ${'password'} | ${null}               | ${password_null}
    ${'password'} | ${'P4ss'}             | ${password_size}
    ${'password'} | ${'lllowercase'}      | ${password_pattern}
    ${'password'} | ${'ALLUPPERCASE'}     | ${password_pattern}
    ${'password'} | ${'1234567'}          | ${password_pattern}
    ${'password'} | ${'lowerandUPPER'}    | ${password_pattern}
    ${'password'} | ${'lower4and5432234'} | ${password_pattern}
    ${'password'} | ${'UPPER4444'}        | ${password_pattern}
  `(
    'returns $expectedMessage when $field is $value when language is set as russian',
    async ({ field, expectedMessage, value }) => {
      const user = {
        username: 'user1',
        email: 'user1@example.com',
        password: 'Pass1234',
      };

      user[field] = value;
      const response = await postUser(user, { language: 'ru' });
      const body = response.body;
      expect(body.validationErrors[field]).toBe(expectedMessage);
    }
  );

  it(`returns ${email_inuse} when same email is already in use when language is set as russian`, async () => {
    await User.create({ ...validUser });
    const response = await postUser({ ...validUser }, { language: 'ru' });
    expect(response.body.validationErrors.email).toBe(email_inuse);
  });

  it(`returns success message of ${user_create_success} when signup request is valid when language is set as russian`, async () => {
    const response = await postUser({ ...validUser }, { language: 'ru' });
    expect(response.body.message).toBe(user_create_success);
  });

  it(`returns ${email_failure} message when sending email fails when language is set as russian`, async () => {
    simulateSmtpFailure = true;
    const response = await postUser({ ...validUser }, { language: 'ru' });
    expect(response.body.message).toBe(email_failure);
  });

  it(`returns ${validation_failure} failure message in error response body when validation fails`, async () => {
    const response = await postUser(
      {
        username: null,
        email: validUser.email,
        password: 'P4ssword',
      },
      { language: 'ru' }
    );
    expect(response.body.message).toBe(validation_failure);
  });

  // The End
});

describe('Account activation', () => {
  it('activates the account then correct token is sent', async () => {
    await postUser();
    let users = await User.findAll();
    const token = users[0].activationToken;
    await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    users = await User.findAll();
    expect(users[0].inactive).toBe(false);
  });

  it('removes the token from user table after successful activation', async () => {
    await postUser();
    let users = await User.findAll();
    const token = users[0].activationToken;
    await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    users = await User.findAll();
    expect(users[0].activationToken).toBeFalsy();
  });

  it('does not activate the account when token is wrong', async () => {
    await postUser();
    const token = 'this-token-does-not-exist';
    await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    const users = await User.findAll();
    expect(users[0].inactive).toBe(true);
  });

  it('returns bad request when token is wrong', async () => {
    await postUser();
    const token = 'this-token-does-not-exist';
    const response = await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    expect(response.status).toBe(400);
  });

  it.each`
    language | tokenStatus  | message
    ${'ru'}  | ${'wrong'}   | ${'Эта учетная запись либо активна, либо токен недействителен'}
    ${'en'}  | ${'wrong'}   | ${'This account is either active or the token is invalid'}
    ${'ru'}  | ${'correct'} | ${'Аккаунт активирован'}
    ${'en'}  | ${'correct'} | ${'Account is activated'}
  `(
    'returns $message when token is $tokenStatus send and language is $language',
    async ({ language, tokenStatus, message }) => {
      await postUser();
      let token = 'this-token-does-not-exist';

      if (tokenStatus === 'correct') {
        let users = await User.findAll();
        token = users[0].activationToken;
      }

      const response = await request(app)
        .post('/api/1.0/users/token/' + token)
        .set('Accept-Language', language)
        .send();
      expect(response.body.message).toBe(message);
    }
  );

  // The End
});

describe('Error Model', () => {
  it('returns path, timestamp, message and validationErrors in response when validation failure', async () => {
    const response = await postUser({ ...validUser, username: null });
    const body = response.body;
    expect(Object.keys(body)).toEqual([
      'path',
      'timestamp',
      'message',
      'validationErrors',
    ]);
  });

  it('returns path, timestamp and message in response when request fails other than validation error', async () => {
    const token = 'this-token-does-not-exist';
    const response = await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    const body = response.body;
    expect(Object.keys(body)).toEqual(['path', 'timestamp', 'message']);
  });

  it('returns path in error body', async () => {
    const token = 'this-token-does-not-exist';
    const response = await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    const body = response.body;
    expect(body.path).toEqual('/api/1.0/users/token/' + token);
  });

  it('returns timestamp in milliseconds within 5 seconds value in error body', async () => {
    const nowInMillis = new Date().getTime();
    const fiveSecondsLater = nowInMillis + 5 * 1000;
    const token = 'this-token-does-not-exist';
    const response = await request(app)
      .post('/api/1.0/users/token/' + token)
      .send();
    const body = response.body;
    expect(body.timestamp).toBeGreaterThan(nowInMillis);
    expect(body.timestamp).toBeLessThan(fiveSecondsLater);
  });

  // The End
});
