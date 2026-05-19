export interface PermissionCatalogEntry {
  key: string;
  label: string;
  description: string;
}

export interface PermissionCatalogGroup {
  name: string;
  permissions: PermissionCatalogEntry[];
}

export interface PermissionCatalogModule {
  module: string;
  groups: PermissionCatalogGroup[];
}
