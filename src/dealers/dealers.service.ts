import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type Dealer = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp_number: string | null;
  address: string | null;
  state: string | null;
  district: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
};

@Injectable()
export class DealersService {
  constructor(private readonly db: DbService) {}

  async findByDistrict(state: string, district: string, limit = 3): Promise<Dealer[]> {
    return this.db.many<Dealer>(
      `SELECT * FROM dealers
       WHERE is_active = TRUE AND state ILIKE $1 AND district ILIKE $2
       ORDER BY name ASC
       LIMIT $3`,
      [state, district, limit],
    );
  }

  /**
   * Haversine-based nearest dealer search. Phase 2 should swap this for
   * PostGIS ST_DWithin once we move to a postgis-enabled image.
   */
  async findNearest(lat: number, lng: number, limit = 3): Promise<Dealer[]> {
    return this.db.many<Dealer>(
      `SELECT *,
              (6371 * acos(
                cos(radians($1)) * cos(radians(lat)) *
                cos(radians(lng) - radians($2)) +
                sin(radians($1)) * sin(radians(lat))
              )) AS distance_km
       FROM dealers
       WHERE is_active = TRUE AND lat IS NOT NULL AND lng IS NOT NULL
       ORDER BY distance_km ASC
       LIMIT $3`,
      [lat, lng, limit],
    );
  }
}
