const {
  BaseKonnector, //x the base connector (parent class)
  requestFactory, // to make an http request to site using a parser : json or html
  signin, // to connect to page
  scrape,
  addData, // to save data to cozy
  hydrateAndFilter,
  log,
  errors, // to retreive main errors
} = require('cozy-konnector-libs') // Needed libraries givent by Cozy

const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very useful for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  cheerio: true, // If have to parse HTML to get data
  json: false, // If have to parse Json / deactivate if you use cheerio
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://app.n26.com' // Base url of the site you want to retreive data

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of transactions')
  const $ = await request(`${baseUrl}/transactions`) // Cheerio
  log('info', 'Parsing list of transactions')
  const transactions = await parseDocuments($)
  // here we use the saveBills function even if what we fetch are not bills, but this is the most
  // common case in connectors
  log('info', 'Save data to Cozy if not already exists')
  const notAlreadySavedTransactions = await hydrateAndFilter(transactions, 'io.cozy.bank.operations', {keys: ['id']})
  await addData(transactions, 'io.cozy.bank.operations')
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  return signin({
    url: `https://app.n26.com/login`,
    formSelector: 'form',
    formData: {username, password },
    // the validate function will check if the login request was a success. Every website has
    // different ways respond: http status code, error message in html ($), http redirection
    // (fullResponse.request.uri.href)...
    validate: (statusCode, $) => {
      // If this div has no children : user logged in
      log('info', $('#login-errors').children().length)
      return $('#login-errors').children().length === 0 || log('error', 'Invalid credentials') 
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  var transactions = scrape(
    $,
    {
      title: 'div a',
      amount: {
        sel: 'div span',
        parse: normalizeAmount
    },
      transaction_date: 'div time',
      id: {
        sel: 'div a',
        attr: 'href'
      }
    },
    'li'
  )

  // Remove all items wich are waiting
  transactions = transactions.filter(transaction => transaction.transaction_date != "")

  return transactions.map(transaction => (
    {
    ...transaction,
    // the saveBills function needs a date field
    // even if it is a little artificial here (these are not real bills)
    date: new Date(),
    currency: '€',
    vendor: 'n26',
    metadata: {
      // it can be interesting that we add the date of import. This is not mandatory but may be
      // useful for debugging or data migration
      importDate: new Date(),
      // document version, useful for migration after change of document structure
      version: 1 // #TODO et amount contien du text
    } // #TODO et amount contien du text
  }))
}

// Convert an amount string to a float
function normalizeAmount(amount) {
  amount = amount.replace('−', '-')
  amount = amount.replace(',', '.')
  return parseFloat(amount.replace('€', '').trim())
}
