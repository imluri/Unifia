const thunderstore = require('./thunderstore');

// All registered mod hub providers. Add a hub by dropping its module here.
function getProviders() {
  return [thunderstore];
}

module.exports = { getProviders };
