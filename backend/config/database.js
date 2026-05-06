const dbClient = (process.env.DB_CLIENT || 'sqlite').toLowerCase();

if (dbClient === 'postgres' || dbClient === 'postgresql') {
  module.exports = require('./database.postgres');
} else {
  module.exports = require('./database.sqlite');
}
