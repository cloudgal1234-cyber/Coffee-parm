// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json).
const { handleApi } = require('../server/api');

module.exports = (req, res) => handleApi(req, res);
