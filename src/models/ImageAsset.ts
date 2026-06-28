import { Schema, model, Document, Types } from 'mongoose';

export type ImageKind = 'profile' | 'portfolio' | 'national_card' | 'blog' | 'social';

/**
 * A stored image (TEMPORARY test-phase storage in MongoDB as BinData).
 *
 * Images are processed to webp on upload and kept here as Buffers, so the main
 * domain documents (User, StylistProfile, …) stay light — they only reference an
 * imageId. A separate thumbnail buffer powers lists/avatars cheaply. Private
 * images (national_card) are never servable via the public /images route.
 */
export interface IImageAsset extends Document {
  _id: Types.ObjectId;
  ownerType?: string;
  ownerId?: Types.ObjectId;
  kind?: ImageKind;
  mime: string; // always 'image/webp' here
  width?: number;
  height?: number;
  sizeBytes: number;
  data: Buffer; // full-size webp
  thumbnailData?: Buffer; // small webp for lists/avatars
  isPrivate: boolean;
  createdAt: Date;
}

const imageAssetSchema = new Schema<IImageAsset>(
  {
    ownerType: { type: String },
    ownerId: { type: Schema.Types.ObjectId },
    kind: { type: String, enum: ['profile', 'portfolio', 'national_card', 'blog', 'social'] },
    mime: { type: String, required: true, default: 'image/webp' },
    width: { type: Number },
    height: { type: Number },
    sizeBytes: { type: Number, required: true },
    data: { type: Buffer, required: true },
    thumbnailData: { type: Buffer },
    isPrivate: { type: Boolean, default: false, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Fast cleanup of an owner's images of a given kind (e.g. delete national_card).
imageAssetSchema.index({ ownerId: 1, kind: 1 });

export const ImageAsset = model<IImageAsset>('ImageAsset', imageAssetSchema);
