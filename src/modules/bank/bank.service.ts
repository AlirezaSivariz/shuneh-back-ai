import { AppError } from '../../utils/AppError';
import { User } from '../../models/User';

export async function getBankInfo(userId: string) {
  const user = await User.findById(userId).select('cardNumber shebaNumber').lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
  return {
    cardNumber: user.cardNumber ?? null,
    shebaNumber: user.shebaNumber ?? null,
  };
}

export async function setBankInfo(
  userId: string,
  input: { shebaNumber?: string | null; cardNumber?: string | null },
) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  const sheba = input.shebaNumber?.trim().toUpperCase().replace(/\s+/g, '') || null;
  const card = input.cardNumber?.replace(/\D/g, '') || null;
  if (sheba && !/^IR\d{24}$/.test(sheba)) {
    throw AppError.badRequest('شماره شبا نامعتبر است (IR و ۲۴ رقم)', 'INVALID_SHEBA');
  }
  if (card && !/^\d{16}$/.test(card)) {
    throw AppError.badRequest('شماره کارت باید ۱۶ رقم باشد', 'INVALID_CARD');
  }

  user.cardNumber = card;
  user.shebaNumber = sheba;
  await user.save();

  return { cardNumber: card, shebaNumber: sheba };
}
