import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { EmailService } from '~/email/EmailService';
import { User } from '~/user/User';

const generateToken = (length) => {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
};

const save = async (body) => {
  const { username, email, password } = body;
  const hash = await bcrypt.hash(password, 10);
  const user = {
    username,
    email,
    password: hash,
    activationToken: generateToken(16),
  };
  await User.create(user);
  await EmailService.sendAccountActivation(email, user.activationToken);
};

const findByEmail = async (email) => {
  return await User.findOne({ where: { email: email } });
};

export const UserService = {
  save,
  findByEmail,
};
