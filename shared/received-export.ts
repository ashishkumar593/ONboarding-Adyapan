export type ReceivedExport = {
  workbook: string;
  files: { path: string; id: string; bytes: number }[];
  records: { name: string; input: string }[];
};
