const {
  BaseKonnector, // the base connector (parent class)
  requestFactory, // to make an http request to site using a parser : json or html
  addData, // to save data to cozy
  hydrateAndFilter, // for no duplication of data
  updateOrCreate,
  log
} = require('cozy-konnector-libs') // Needed libraries givent by Cozy

const N26 = require('n26')

const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very useful for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  cheerio: true, // If have to parse HTML to get data
  json: false, // If have to parse Json / deactivate if you use cheerio
  jar: true
})

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  const account = await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Getting Account infos')
  const accountInfos = await account.account()

  log('info', 'Fetching transactions')
  const transactions = await account.transactions({})

  log('info', 'Save transactions to Cozy')
  await saveTransactions(transactions)

  log('info', 'Save account balance to Cozy')
  await saveBalance(accountInfos.bankBalance)

  log('info', 'Save account infos to Cozy')
  await saveAccount(accountInfos)
}

/**
 * Authenticate user to n26 with username and password
 * @param String username 
 * @param String password 
 */
function authenticate(username, password) {
  return new N26(username, password)
}

/**
 * Save transactions to Cozy Stack
 * @param [] transactions 
 */
function saveTransactions(transactions) {
  const notAlreadySavedTransactions = hydrateAndFilter(transactions, 'io.cozy.bank.operations', {keys: ['id']})
  addData(notAlreadySavedTransactions, 'io.cozy.bank.operations')
}

/**
 *  Save the actual account balance to Cozy Stack
 * @param Int balance 
 */
function saveBalance(balance) {
  const data = {
    balance: balance, 
    metadata: {
      importDate: new Date(),
      version: 1
    }} 
  return updateOrCreate([data], 'io.cozy.bank.balancehistories', ['_id'])
}

/**
 * Save N26 account to Cozy
 * @param Object accountInfos
 */
function saveAccount(accountInfos) {
  const data = {
    num: accountInfos.id,
    bank: accountInfos.bankName,
    iban: accountInfos.iban,
    bic: accountInfos.bic,
    currency: accountInfos.currency
  }
  return updateOrCreate([data], 'io.cozy.bank.accounts', ['num', 'iban', 'bic'])
}
