// An error with an HTTP status, picked up by the error handler in server.js
// (it reads err.status and err.message), e.g. new HttpError(409, 'Game is full')
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
