
export class ApplicationError extends Error {
  extra?: any;
  constructor(message: string, options?: any) {
    super(message);
    this.extra = options?.extra;
  }
}
export class UserError extends Error {}
