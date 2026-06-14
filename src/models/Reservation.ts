import { Schema, model, Document, Types } from 'mongoose';
import { iranWallClockToUtc } from '../utils/timezone';

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export const RESERVATION_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
];

export interface IReservation extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  stylistId: Types.ObjectId;
  salonId: Types.ObjectId | null;
  serviceId: Types.ObjectId;
  /** All services in this booking (>= 1). serviceId mirrors serviceIds[0]. */
  serviceIds: Types.ObjectId[];
  /**
   * Per-service price/duration snapshot at booking time (for reporting).
   * The aggregate `price` equals the sum of items[].price.
   */
  items: { serviceId: Types.ObjectId; price: number; durationMin: number }[];
  /** Calendar day of the booking (Iran day in its UTC components). */
  date: Date;
  startTime: string; // HH:mm (Iran wall clock)
  endTime: string; // HH:mm (Iran wall clock)
  /** Absolute UTC instants derived from date + start/endTime in Iran time. */
  startAt: Date;
  endAt: Date;
  /** Total snapshot price of the booking (GROSS — sum of items[].price). */
  price?: number;
  /**
   * Discount snapshot (set only when a discount code was applied at booking).
   * `originalPrice` mirrors the gross `price`; `finalPrice` is what the customer
   * pays after `discountAmount`. `price` stays gross so existing reports are
   * unaffected; `finalPrice` carries the net charged amount.
   */
  discountCode?: string | null;
  discountType?: 'percentage' | 'fixed' | null;
  discountValue?: number | null;
  discountAmount?: number | null;
  originalPrice?: number | null;
  finalPrice?: number | null;
  /** Optional free-text note from the customer to the stylist (read-only for stylist). */
  customerNote?: string | null;
  status: ReservationStatus;
  completedAt?: Date;
  /** Who cancelled (set when status becomes 'cancelled'). */
  cancelledBy?: 'customer' | 'stylist' | 'admin' | null;
  cancelReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const reservationSchema = new Schema<IReservation>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salonId: { type: Schema.Types.ObjectId, ref: 'Salon', default: null },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceIds: { type: [Schema.Types.ObjectId], ref: 'Service', default: [] },
    items: {
      type: [
        new Schema(
          {
            serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
            price: { type: Number, required: true, min: 0 },
            durationMin: { type: Number, required: true, min: 1 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    price: { type: Number, min: 0 },
    discountCode: { type: String, default: null },
    discountType: { type: String, enum: ['percentage', 'fixed', null], default: null },
    discountValue: { type: Number, default: null, min: 0 },
    discountAmount: { type: Number, default: null, min: 0 },
    originalPrice: { type: Number, default: null, min: 0 },
    finalPrice: { type: Number, default: null, min: 0 },
    customerNote: { type: String, default: null, maxlength: 500 },
    status: {
      type: String,
      enum: RESERVATION_STATUSES,
      default: 'pending',
      index: true,
    },
    completedAt: { type: Date },
    cancelledBy: { type: String, enum: ['customer', 'stylist', 'admin', null], default: null },
    cancelReason: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * Always keep the absolute instants in sync with date + start/endTime so the
 * auto-complete query can compare against `endAt` directly.
 */
reservationSchema.pre('validate', function (next) {
  const doc = this as unknown as IReservation;
  if (doc.date && doc.startTime) doc.startAt = iranWallClockToUtc(doc.date, doc.startTime);
  if (doc.date && doc.endTime) doc.endAt = iranWallClockToUtc(doc.date, doc.endTime);
  next();
});

// Helps the auto-complete bulk query (status + endAt range).
reservationSchema.index({ status: 1, endAt: 1 });
// Helps the quick-rebook aggregation (a customer's completed history).
reservationSchema.index({ customerId: 1, status: 1 });

export const Reservation = model<IReservation>('Reservation', reservationSchema);
