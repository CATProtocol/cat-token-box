export class CatTxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatTxError';
  }
}

export class TransferTxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferTxError';
  }
}
