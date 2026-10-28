"use strict";

class ApiError extends Error {
  constructor(detail, status = 400) {
    super(detail);
    this.detail = detail;
    this.status = status;
  }
}

module.exports = { ApiError };
