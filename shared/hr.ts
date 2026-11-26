export const hrPermissions = ["invite", "review", "issue", "export"] as const;
export type Permission = (typeof hrPermissions)[number];
