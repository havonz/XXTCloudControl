// Device grouping types

export interface GroupInfo {
  id: string;
  name: string;
  deviceIds: string[];
  sortOrder: number;
  scriptPath?: string;
}
