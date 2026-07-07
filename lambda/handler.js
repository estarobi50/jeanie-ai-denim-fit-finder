// Lambda entry point. Wraps the existing Express app from ../server.js
// with serverless-http so API Gateway events become Express requests.
//
// The Express app is exported from server.js when require()d under Lambda
// (i.e. when AWS_LAMBDA_FUNCTION_NAME is set) instead of calling app.listen().

const serverless = require('serverless-http');
const app = require('../server.js');

module.exports.handler = serverless(app);
