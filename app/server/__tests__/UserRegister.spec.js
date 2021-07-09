import request from 'supertest';
import { app } from '~/app';
import { sequelize } from '~/config/database';
import { User } from '~/user/User';

beforeAll(() => {
  return sequelize.sync();
});

beforeEach(() => {
  return User.destroy({
    truncate: true,
  });
});

describe('User Registration', () => {
  const postValidUser = () => {
    return request(app).post('/api/1.0/users').send({
      username: 'user1',
      email: 'user1@example.com',
      password: 'pass1234',
    });
  };

  it('returns 200 OK when signup request is valid', async () => {
    const response = await postValidUser();
    expect(response.statusCode).toBe(200);
  });

  it('returns success message when signup request is valid', async () => {
    const response = await postValidUser();
    expect(response.body.message).toBe('User created');
  });

  it('saves the user to database', async () => {
    await postValidUser();
    const userList = await User.findAll();
    expect(userList.length).toBe(1);
  });

  it('saves the username and email to database', async () => {
    await postValidUser();
    const userList = await User.findAll();
    const savedUser = userList[0];
    expect(savedUser.username).toBe('user1');
    expect(savedUser.email).toBe('user1@example.com');
  });

  it('hashes the password in databas', async () => {
    await postValidUser();
    const userList = await User.findAll();
    const savedUser = userList[0];
    expect(savedUser.password).not.toBe('pass1234');
  });

  // The End
});
