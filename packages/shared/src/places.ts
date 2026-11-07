// Branch hierarchy (Region > Taluka > Branch) and the playlist set at each level.

/** A level a playlist can be set on, apart from a single screen. */
export type PlaceLevel = 'ALL' | 'REGION' | 'TALUKA' | 'BRANCH';

export interface PlacePlaylist {
  id: string;
  name: string;
}

export interface ScreenCounts {
  total: number;
  online: number;
}

export interface BranchNode {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  /** Playlist set on this branch itself, not inherited. */
  playlist: PlacePlaylist | null;
  screens: ScreenCounts;
}

export interface TalukaNode {
  id: string;
  name: string;
  playlist: PlacePlaylist | null;
  screens: ScreenCounts;
  branches: BranchNode[];
}

export interface RegionNode {
  id: string;
  name: string;
  playlist: PlacePlaylist | null;
  screens: ScreenCounts;
  talukas: TalukaNode[];
}

export interface PlaceTree {
  /** Playlist for every screen that has nothing more specific. */
  allPlaylist: PlacePlaylist | null;
  screens: ScreenCounts;
  regions: RegionNode[];
}

export interface CreateRegionRequest {
  name: string;
}
export interface CreateTalukaRequest {
  name: string;
  regionId: string;
}
export interface CreateBranchRequest {
  name: string;
  code?: string | null;
  address?: string | null;
  talukaId: string;
}
export type UpdateRegionRequest = Partial<CreateRegionRequest>;
export type UpdateTalukaRequest = Partial<CreateTalukaRequest>;
export type UpdateBranchRequest = Partial<CreateBranchRequest>;

export interface SetPlacePlaylistRequest {
  level: PlaceLevel;
  /** Region, taluka or branch id; omitted for ALL. */
  id?: string;
  playlistId: string | null;
}
