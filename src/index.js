const {
  BaseKonnector, // the base connector (parent class)
  requestFactory, // to make an http request to site using a parser : json or html
  addData, // to save data to cozy
  hydrateAndFilter, // for no duplication of data
  updateOrCreate,
  signin,
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

const baseUrl = 'https://app.n26.com'
const transactionsUrl = `${baseUrl}/transactions`
const loginUrl = `${baseUrl}/login`

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  const account = await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Getting Account infos')
  const accountInfos = await account.account()

  log('info', 'Getting User infos')
  const userInfos = await account.me(false)

  log('info', 'Fetching transactions')
  const $ = await request(transactionsUrl) // For cheerio to get datetime of transaction (not providing by API)
  const transactions = await account.transactions({})

  log('info', 'Save transactions to Cozy')
  await saveTransactions(transactions, $)

  log('info', 'Save account balance to Cozy')
  await saveBalance(accountInfos.bankBalance)

  log('info', 'Save account infos to Cozy')
  await saveAccount(userInfos, accountInfos)
}

/**
 * Authenticate user to n26 with username and password
 * @param String username 
 * @param String password 
 */
function authenticate(username, password) {
  authenticateWithCheerio(username, password) // For cheerio to get transaction datetime
  return new N26(username, password)
}

/**
 * Save transactions to Cozy Stack
 * @param [] transactions 
 */
function saveTransactions(transactions, $) {
  //TODO: map transaction an d change content
  transactions.map(transaction => {
    log('info', transaction)

    // Get datetime
    const date = getTransactionDate(transaction.id, $)

    // Choose right type
    let type
    if(transaction.type == 'DT')
      type = 'direct debit' // Envoie d'argent dans un espace N26
    if(transaction.type == 'CT')
      type = 'transfert' // Une personnes m'envoie de l'argent depuis son compte
    if(transaction.type == 'PT')
      type = 'cash' // Retrait à un distributeur
    if(transaction.type == 'WU')
      type = 'none' // Virement de la part de la banque 

    transaction = {
      label: transaction.referenceText,
      type: type,
      amount: transaction.amount,
      currency: transaction.currencyCode,
      dateImport: new Date(),
      date: date,
    }
  })
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
function saveAccount(userInfos, accountInfos) {
  const data = {
    label: userInfos.firstName+' '+userInfos.lastName,
    institutionLabel: accountInfos.bankName,
    balance: accountInfos.bankBalance,
    type: 'bank',
    number: accountInfos.iban.slice(12),
    iban: accountInfos.iban,
    metadata: {
      version: 1
    },
  }
  return updateOrCreate([data], 'io.cozy.bank.accounts', ['number', 'iban'])
}

function getTransactionDate(id, $) {
  const a = $(`a[href="/transactions/${id}"]`, '#transactions')
  const div = a.parent()
  const datetime = $('time', div).attr('datetime')
  return datetime
}

function authenticateWithCheerio(username, password) {
  return signin({
    url: loginUrl,
    formSelector: 'form',
    formData: {username, password},
    validate: (statusCode, $) => {
      // Logged if this div has no children
      log('info', $('#login-errors').children().length)
      return $('#login-errors').children().length === 0 || log('error', 'Invalid credentials') 
    }
  })
}