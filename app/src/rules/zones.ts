// Zone parameters from the Ministerial Regulation enforcing the
// Bangkok Comprehensive Plan B.E. 2556 (2013), clauses 8-22.
// Read clause by clause from the regulation text; see docs/DECISIONS.md §2.

export type ZoneCode = 'ย.8'

export interface UseLimit {
  /** Floor-area / room band upper bound (inclusive). Infinity = open ended. */
  upTo: number
  /** Minimum right-of-way width of the abutting public road (m). null = prohibited unless near station. */
  minRoad: number | null
}

export interface Zone {
  code: ZoneCode
  nameTh: string
  nameEn: string
  colour: string
  clause: number
  far: number
  osrPct: number
  plantedShareOfOpen: number
  publicOpenSpaceBonus: boolean
  /** Hotels: rooms above which a wide road or a station is needed. */
  hotel: { freeRooms: number; minRoad: number }
  /** Offices: floor area (m²) bands. Above the last band: prohibited. */
  office: UseLimit[]
  condo: { note: string }
}

export const ZONES: Record<ZoneCode, Zone> = {
  'ย.8': {
    code: 'ย.8',
    nameTh: 'ที่อยู่อาศัยหนาแน่นมาก',
    nameEn: 'Very high-density residential (brown)',
    colour: '#8B5A2B',
    clause: 15,
    far: 6,
    osrPct: 5,
    plantedShareOfOpen: 0.5,
    publicOpenSpaceBonus: true,
    hotel: { freeRooms: 50, minRoad: 16 }, // cl.15(8)
    office: [
      // cl.15(12): offices >1,000 m² prohibited except bands below,
      // each also allowed if within 500 m of a mass-transit station.
      { upTo: 1000, minRoad: 0 },
      { upTo: 2000, minRoad: 12 },
      { upTo: 5000, minRoad: 16 },
      { upTo: 10000, minRoad: 30 },
      { upTo: Infinity, minRoad: null },
    ],
    condo: {
      note: 'Clause 15 places no size or road-width condition on residential condominiums (อาคารอยู่อาศัยรวม) in ย.8.',
    },
  },
}

/** Context: the whole 2013 brown/red family, shown for comparison only. */
export const FAR_TABLE: { code: string; far: number; osr: number }[] = [
  { code: 'ย.5', far: 4, osr: 7.5 },
  { code: 'ย.6', far: 4.5, osr: 6.5 },
  { code: 'ย.7', far: 5, osr: 6 },
  { code: 'ย.8', far: 6, osr: 5 },
  { code: 'ย.9', far: 7, osr: 4.5 },
  { code: 'ย.10', far: 8, osr: 4 },
  { code: 'พ.5', far: 10, osr: 3 },
]
