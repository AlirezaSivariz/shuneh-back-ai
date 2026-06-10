import { Role } from '../models/User';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      roles: Role[];
    }
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
