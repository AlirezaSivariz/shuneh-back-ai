/**
 * GeoJSON helpers. MongoDB stores coordinates as [longitude, latitude].
 */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export function toGeoPoint(lng: number, lat: number): GeoPoint {
  if (lng < -180 || lng > 180) throw new Error('longitude must be between -180 and 180');
  if (lat < -90 || lat > 90) throw new Error('latitude must be between -90 and 90');
  return { type: 'Point', coordinates: [lng, lat] };
}
