export interface PrintRequest {
  paperWidth: 58 | 80;
}
export interface PrintAdapter {
  readonly id: string;
  readonly silent: boolean;
  print(request: PrintRequest): Promise<void>;
}
